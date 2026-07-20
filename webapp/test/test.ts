import { DOMParser } from "@xmldom/xmldom";
import { convert, ConversionRule } from "../model/Converter";

const parser = new DOMParser();
const parseXml = (s: string): Document =>
    parser.parseFromString(s, "text/xml") as unknown as Document;

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Order xmlns="urn:demo:orders">
  <OrderID>4711</OrderID>
  <Customer>
    <Name>ACME Corp</Name>
    <Premium>true</Premium>
  </Customer>
  <Items>
    <Item id="10">
      <Material>MAT-001</Material>
      <Quantity>5</Quantity>
      <Price>19.99</Price>
    </Item>
  </Items>
  <Note/>
</Order>`;

const rules: ConversionRule[] = [
    { namespace: "", path: "Item", forceArray: true, type: "None" },
    { namespace: "", path: "Quantity", forceArray: false, type: "Integer" },
    { namespace: "", path: "Price", forceArray: false, type: "Decimal" },
    { namespace: "", path: "Premium", forceArray: false, type: "Boolean" },
    { namespace: "", path: "OrderID", forceArray: false, type: "String" }
];

let failures = 0;
function check(name: string, cond: boolean): void {
    if (!cond) {
        failures++;
        console.log("FAIL:", name);
    } else {
        console.log("ok:", name);
    }
}

/* eslint-disable @typescript-eslint/no-explicit-any */

// Test 1: rules applied
let out: any = convert(xml, { rules, parseXml }).result;
console.log(JSON.stringify(out, null, 2));
check("single Item forced to array", Array.isArray(out.Order.Items.Item));
check("Quantity is number 5", out.Order.Items.Item[0].Quantity === 5);
check("Price is 19.99", out.Order.Items.Item[0].Price === 19.99);
check("Premium is boolean true", out.Order.Customer.Premium === true);
check("OrderID stays string", out.Order.OrderID === "4711");
check("attribute mapped with @", out.Order.Items.Item[0]["@id"] === "10");
check('empty Note is ""', out.Order.Note === "");

// Test 2: no rules -> everything string, single Item is object
out = convert(xml, { parseXml }).result;
check("no rules: Item is object", !Array.isArray(out.Order.Items.Item));
check("no rules: Quantity string", out.Order.Items.Item.Quantity === "5");

// Test 3: strip outer + omit empty + no attributes + repeating elements
const xml2 = `<r><i>1</i><i>2</i><e/><a x="1">t</a></r>`;
out = convert(xml2, {
    parseXml,
    stripOuter: true,
    emptyMode: "omit",
    includeAttributes: false,
    rules: [{ path: "i", type: "Integer", forceArray: false }]
}).result;
check("strip outer: no r wrapper", out.i !== undefined && out.r === undefined);
check("repeating i auto-array [1,2]", Array.isArray(out.i) && out.i[0] === 1 && out.i[1] === 2);
check("empty e omitted", !("e" in out));
check("attributes ignored", out.a === "t");

// Test 4: null mode + absolute path rule + namespace matching
out = convert(xml2, { parseXml, emptyMode: "null" }).result;
check("empty e is null", out.r.e === null);

out = convert(xml, {
    parseXml,
    rules: [{ namespace: "urn:other", path: "Item", forceArray: true }]
}).result;
check("namespace mismatch: rule not applied", !Array.isArray(out.Order.Items.Item));

out = convert(xml, {
    parseXml,
    rules: [{ namespace: "urn:demo:orders", path: "/Order/Items/Item", forceArray: true }]
}).result;
check("absolute path + namespace match", Array.isArray(out.Order.Items.Item));

// Test 5: coercion warning
const r5 = convert(`<r><q>abc</q></r>`, {
    parseXml,
    rules: [{ path: "q", type: "Integer" }]
});
check("invalid int kept as string", (r5.result as any).r.q === "abc");
check("warning emitted", r5.warnings.length === 1);

// Test 6: text + attributes -> text key
out = convert(`<r><a x="1">hello</a></r>`, { parseXml }).result;
check("text key $ used", out.r.a.$ === "hello" && out.r.a["@x"] === "1");

console.log(failures ? `\n${failures} FAILURES` : "\nAll tests passed");
process.exit(failures ? 1 : 0);
