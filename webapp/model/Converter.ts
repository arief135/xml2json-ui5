/*
 * XML -> JSON conversion engine modeled after the SAP PI/PO REST adapter
 * "Custom XML/JSON Conversion Rules":
 *   - per-element rules (namespace + path/name) to force arrays
 *   - per-element JSON type coercion (String / Integer / Decimal / Boolean)
 *   - strip outer element, attribute handling, empty-element modes
 *
 * Pure TypeScript module with no UI5 dependencies, so it can be unit-tested
 * in Node (see test.ts) and reused anywhere.
 */

export type JsonType = "None" | "String" | "Integer" | "Decimal" | "Boolean";

export interface ConversionRule {
    /** Optional namespace URI the element must be in; empty = any namespace */
    namespace?: string;
    /**
     * Element name ("Item"), relative path ("Items/Item"),
     * or absolute path ("/Order/Items/Item")
     */
    path?: string;
    /** Serialize as a JSON array even for a single occurrence */
    forceArray?: boolean;
    /** Target JSON type; "None" keeps the default (string) */
    type?: JsonType;
}

export type EmptyMode = "empty" | "null" | "omit";

export interface ConverterConfig {
    rules?: ConversionRule[];
    /** Drop the root element wrapper (default false) */
    stripOuter?: boolean;
    /** Map XML attributes to JSON keys (default true) */
    includeAttributes?: boolean;
    /** Prefix for attribute keys (default "@") */
    attrPrefix?: string;
    /** Key for text in mixed/attributed elements (default "$") */
    textKey?: string;
    /** How to render empty elements (default "empty") */
    emptyMode?: EmptyMode;
    /** Optional XML parser override, used by Node unit tests */
    parseXml?: (xml: string) => Document;
}

export type JsonValue =
    | string
    | number
    | boolean
    | null
    | JsonValue[]
    | { [key: string]: JsonValue };

export interface ConversionOutcome {
    result: JsonValue;
    warnings: string[];
}

interface ResolvedOptions {
    stripOuter: boolean;
    includeAttributes: boolean;
    attrPrefix: string;
    textKey: string;
    emptyMode: EmptyMode;
}

const INT_PATTERN = /^[+-]?\d+$/;

function getChildElements(node: Node): Element[] {
    const out: Element[] = [];
    const list = node.childNodes;
    for (let i = 0; i < list.length; i++) {
        if (list[i].nodeType === 1) { // ELEMENT_NODE
            out.push(list[i] as Element);
        }
    }
    return out;
}

function getOwnText(node: Node): string {
    let text = "";
    const list = node.childNodes;
    for (let i = 0; i < list.length; i++) {
        const t = list[i].nodeType;
        if (t === 3 || t === 4) { // TEXT_NODE or CDATA_SECTION_NODE
            text += list[i].nodeValue ?? "";
        }
    }
    return text.trim();
}

function getAttributes(el: Element): Attr[] {
    const out: Attr[] = [];
    const attrs = el.attributes;
    for (let i = 0; i < attrs.length; i++) {
        const a = attrs[i];
        if (a.name === "xmlns" || a.name.startsWith("xmlns:")) {
            continue; // namespace declarations are not payload data
        }
        out.push(a);
    }
    return out;
}

function localName(el: Element): string {
    return el.localName || el.nodeName.replace(/^.*:/, "");
}

/**
 * A rule matches an element when:
 *  - its path starts with "/"  -> exact absolute path match, e.g. /Order/Items/Item
 *  - otherwise                 -> element name match, or relative path suffix
 *                                 match, e.g. "Item" or "Items/Item"
 *  - if the rule has a namespace, the element's namespace URI must equal it
 */
function findRule(
    el: Element,
    path: string,
    rules: ConversionRule[]
): ConversionRule | null {
    for (const rule of rules) {
        const rPath = (rule.path ?? "").trim();
        if (!rPath) {
            continue;
        }
        let pathMatch: boolean;
        if (rPath.startsWith("/")) {
            pathMatch = rPath === path;
        } else {
            pathMatch =
                rPath === localName(el) ||
                (path.length > rPath.length && path.endsWith("/" + rPath));
        }
        if (!pathMatch) {
            continue;
        }
        const rNs = (rule.namespace ?? "").trim();
        if (rNs && rNs !== (el.namespaceURI ?? "")) {
            continue;
        }
        return rule;
    }
    return null;
}

function coerce(
    text: string,
    rule: ConversionRule | null,
    path: string,
    warnings: string[]
): JsonValue {
    const type = rule?.type;
    if (!type || type === "None" || type === "String") {
        return text;
    }
    if (type === "Integer") {
        if (INT_PATTERN.test(text)) {
            return parseInt(text, 10);
        }
        warnings.push(`Value "${text}" at ${path} is not a valid integer; kept as string.`);
        return text;
    }
    if (type === "Decimal") {
        const n = Number(text);
        if (text !== "" && isFinite(n)) {
            return n;
        }
        warnings.push(`Value "${text}" at ${path} is not a valid decimal; kept as string.`);
        return text;
    }
    if (type === "Boolean") {
        const lower = text.toLowerCase();
        if (lower === "true" || lower === "1") {
            return true;
        }
        if (lower === "false" || lower === "0") {
            return false;
        }
        warnings.push(`Value "${text}" at ${path} is not a valid boolean; kept as string.`);
        return text;
    }
    return text;
}

/** Value for an element that carries no text (e.g. <Note/>). */
function emptyValue(opt: ResolvedOptions): JsonValue | undefined {
    if (opt.emptyMode === "omit") {
        return undefined;
    }
    if (opt.emptyMode === "null") {
        return null;
    }
    return "";
}

function elementToValue(
    el: Element,
    path: string,
    rules: ConversionRule[],
    opt: ResolvedOptions,
    warnings: string[]
): JsonValue | undefined {
    const rule = findRule(el, path, rules);
    const childEls = getChildElements(el);
    const attrs = opt.includeAttributes ? getAttributes(el) : [];
    const text = getOwnText(el);

    // Simple leaf: no attributes, no element children
    if (!childEls.length && !attrs.length) {
        if (text === "") {
            return emptyValue(opt);
        }
        return coerce(text, rule, path, warnings);
    }

    const obj: { [key: string]: JsonValue } = {};
    for (const attr of attrs) {
        obj[opt.attrPrefix + attr.name] = attr.value;
    }

    // Leaf with attributes: text goes under the text key
    if (!childEls.length) {
        if (text !== "") {
            obj[opt.textKey] = coerce(text, rule, path, warnings);
        } else if (opt.emptyMode === "null") {
            obj[opt.textKey] = null;
        }
        return obj;
    }

    // Group element children by name, preserving first-appearance order
    const groups = new Map<string, Element[]>();
    for (const child of childEls) {
        const key = localName(child);
        const group = groups.get(key);
        if (group) {
            group.push(child);
        } else {
            groups.set(key, [child]);
        }
    }

    for (const [name, group] of groups) {
        const childPath = path + "/" + name;
        const childRule = findRule(group[0], childPath, rules);
        const values: JsonValue[] = [];
        for (const child of group) {
            const v = elementToValue(child, childPath, rules, opt, warnings);
            if (v !== undefined) {
                values.push(v);
            }
        }
        const forceArray = !!childRule?.forceArray;
        if (forceArray || group.length > 1) {
            // Repeating elements always become arrays; a rule forces the
            // array even for a single occurrence (the classic PI/PO fix).
            if (values.length || forceArray) {
                obj[name] = values;
            }
        } else if (values.length) {
            obj[name] = values[0];
        }
    }

    // Mixed content: keep text alongside children under the text key
    if (text !== "") {
        obj[opt.textKey] = coerce(text, rule, path, warnings);
    }
    return obj;
}

export function convert(
    xmlString: string,
    config: ConverterConfig = {}
): ConversionOutcome {
    const opt: ResolvedOptions = {
        stripOuter: !!config.stripOuter,
        includeAttributes: config.includeAttributes !== false,
        attrPrefix: config.attrPrefix ?? "@",
        textKey: config.textKey || "$",
        emptyMode: config.emptyMode ?? "empty"
    };
    const rules = config.rules ?? [];
    const warnings: string[] = [];

    if (!xmlString || !xmlString.trim()) {
        throw new Error("Source XML is empty.");
    }

    const doc = config.parseXml
        ? config.parseXml(xmlString)
        : new DOMParser().parseFromString(xmlString, "application/xml");

    const errors = doc.getElementsByTagName("parsererror");
    if (errors && errors.length) {
        const msg = (errors[0].textContent ?? "Invalid XML").trim().split("\n")[0];
        throw new Error("XML parse error: " + msg);
    }
    const root = doc.documentElement;
    if (!root) {
        throw new Error("No root element found.");
    }

    const rootPath = "/" + localName(root);
    let value = elementToValue(root, rootPath, rules, opt, warnings);
    if (value === undefined) {
        value = opt.emptyMode === "null" ? null : "";
    }

    let result: JsonValue;
    if (opt.stripOuter) {
        result = value;
    } else {
        result = { [localName(root)]: value };
    }
    return { result, warnings };
}

export default { convert };
