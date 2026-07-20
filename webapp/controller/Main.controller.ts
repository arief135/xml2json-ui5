import Controller from "sap/ui/core/mvc/Controller";
import JSONModel from "sap/ui/model/json/JSONModel";
import MessageToast from "sap/m/MessageToast";
import Event from "sap/ui/base/Event";
import Control from "sap/ui/core/Control";
import { convert, ConversionRule, EmptyMode } from "../model/Converter";

interface RuleRow {
    namespace: string;
    path: string;
    forceArray: boolean;
    type: ConversionRule["type"];
}

interface AppOptions {
    stripOuter: boolean;
    includeAttributes: boolean;
    attrPrefix: string;
    textKey: string;
    emptyMode: EmptyMode;
    indent: string;
}

interface AppState {
    xml: string;
    json: string;
    error: string;
    warningText: string;
    rules: RuleRow[];
    options: AppOptions;
}

const SAMPLE_XML = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Order xmlns="urn:demo:orders">',
    "    <OrderID>4711</OrderID>",
    "    <Customer>",
    "        <Name>ACME Corp</Name>",
    "        <Premium>true</Premium>",
    "    </Customer>",
    "    <Items>",
    '        <Item id="10">',
    "            <Material>MAT-001</Material>",
    "            <Quantity>5</Quantity>",
    "            <Price>19.99</Price>",
    "        </Item>",
    "    </Items>",
    "    <Note/>",
    "</Order>"
].join("\n");

const SAMPLE_RULES: RuleRow[] = [
    { namespace: "", path: "/Order/Items/Item", forceArray: true, type: "None" },
    { namespace: "", path: "Quantity", forceArray: false, type: "Integer" },
    { namespace: "", path: "Price", forceArray: false, type: "Decimal" },
    { namespace: "", path: "Premium", forceArray: false, type: "Boolean" },
    { namespace: "", path: "OrderID", forceArray: false, type: "String" }
];


/**
 * @namespace id.apnv.app.xml2jsonui5.controller
 */
export default class Main extends Controller {

    // Assigned in onInit (UI5 lifecycle hook), hence the definite-assignment assertion
    private model!: JSONModel;

    public onInit(): void {
        const initialState: AppState = {
            xml: SAMPLE_XML,
            json: "",
            error: "",
            warningText: "",
            rules: structuredClone(SAMPLE_RULES),
            options: {
                stripOuter: false,
                includeAttributes: true,
                attrPrefix: "@",
                textKey: "$",
                emptyMode: "empty",
                indent: "2"
            }
        };
        this.model = new JSONModel(initialState);
        this.getView()?.setModel(this.model);
        this.onConvert();
    }

    public onConvert(): void {
        const data = this.model.getData() as AppState;
        this.model.setProperty("/error", "");
        this.model.setProperty("/warningText", "");
        try {
            const outcome = convert(data.xml, {
                rules: data.rules,
                stripOuter: data.options.stripOuter,
                includeAttributes: data.options.includeAttributes,
                attrPrefix: data.options.attrPrefix,
                textKey: data.options.textKey,
                emptyMode: data.options.emptyMode
            });
            const indent = parseInt(data.options.indent, 10) || 0;
            const json = indent > 0
                ? JSON.stringify(outcome.result, null, indent)
                : JSON.stringify(outcome.result);
            this.model.setProperty("/json", json);
            if (outcome.warnings.length) {
                this.model.setProperty("/warningText",
                    "Type conversion warnings: " + outcome.warnings.join(" "));
            }
        } catch (error) {
            this.model.setProperty("/json", "");
            this.model.setProperty("/error",
                error instanceof Error ? error.message : String(error));
        }
    }

    public onAddRule(): void {
        const rules = this.model.getProperty("/rules") as RuleRow[];
        rules.push({ namespace: "", path: "", forceArray: false, type: "None" });
        this.model.setProperty("/rules", rules);
    }

    public onDeleteRule(event: Event): void {
        const source = event.getSource() as unknown as Control;
        const contextPath = source.getBindingContext()?.getPath();
        if (!contextPath) {
            return;
        }
        const index = parseInt(contextPath.split("/").pop() ?? "", 10);
        const rules = this.model.getProperty("/rules") as RuleRow[];
        rules.splice(index, 1);
        this.model.setProperty("/rules", rules);
    }

    public onLoadSample(): void {
        this.model.setProperty("/xml", SAMPLE_XML);
        this.model.setProperty("/rules", structuredClone(SAMPLE_RULES));
        this.onConvert();
        MessageToast.show("Sample order and rules loaded");
    }

    public onClearXml(): void {
        this.model.setProperty("/xml", "");
        this.model.setProperty("/json", "");
        this.model.setProperty("/error", "");
        this.model.setProperty("/warningText", "");
    }

    public onClearError(): void {
        this.model.setProperty("/error", "");
    }

    public onCopyJson(): void {
        const json = this.model.getProperty("/json") as string;
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(json).then(
                () => MessageToast.show("JSON copied to clipboard"),
                () => MessageToast.show("Copy failed — select the text and copy manually")
            );
        } else {
            MessageToast.show("Clipboard not available in this browser");
        }
    }

    public onDownloadJson(): void {
        const json = this.model.getProperty("/json") as string;
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "converted.json";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }
}
