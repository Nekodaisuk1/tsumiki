import { writeFileSync } from "node:fs";
import { createDesign, serializeDesign } from "../src/structure/design.ts";
const id = { type: "string", pattern: "^[a-zA-Z][\\w-]{0,39}$" };
const num = (minimum, maximum) => ({ type: "number", minimum, maximum });
const obj = properties => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const list = (items, minItems = 0, maxItems = 100) => ({ type: "array", items, minItems, maxItems });
const fixed = value => ({ const: value });
const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "urn:tsumiki:design:5",
  title: "Tsumiki Design v5",
  description: "Dimensionless design and analysis inputs. Each tenon is five female-board thicknesses; the outermost thickness is reserved for rope. Unique IDs, valid references, nonzero member lengths and rope topology additionally require application validation. clearance-contact joints derive their clearance from geometry.holeSize and geometry.tenonSize; ropeWrap bounds the friction at the rope wraps. openStiffness must be smaller than contactStiffness.",
  ...obj({
    format: fixed("tsumiki-design"), version: fixed(5), solver: fixed("frame3d-contact-v5"), units: fixed("dimensionless"),
    name: { type: "string", maxLength: 200 }, notes: { type: "string", maxLength: 10000 }, jointModel: { enum: ["rigid-approximation", "clearance-contact"] },
    joint: obj({ contactStiffness: num(1e-3, 1e7), openStiffness: num(1e-6, 1e7) }),
    ropeWrap: { enum: ["sliding", "locked"] },
    nodes: list(obj({ id, position: { type: "array", items: num(-20,20), minItems:3, maxItems:3 }, fixed: { type: "boolean" } }),2,32),
    members: list(obj({id,kind:{enum:["male","female"]},start:id,end:id,material:id,roll:num(-180,180),layer:{type:"integer",minimum:0,maximum:3},holeCount:{type:"integer",minimum:2,maximum:32}}),1),
    materials: list(obj({id,E:num(1e-8,1e7),G:num(1e-8,1e7),A:num(1e-8,1e7),Iy:num(1e-8,1e7),Iz:num(1e-8,1e7),J:num(1e-8,1e7),density:num(1e-8,1e7)}),1),
    ropes: list(obj({id,route:{type:"array",items:id,minItems:4,maxItems:4,uniqueItems:true},stiffness:num(0.01,1e5),prestrain:num(0,0.02),slack:num(0,0.2),windingMember:id})),
    connections: list(obj({id,male:id,female:id,end:{enum:["start","end"]},hole:{type:"integer",minimum:0,maximum:31},seat:{type:"integer",minimum:0,maximum:3}})),
    rings: list(obj({id,member:id,end:{enum:["start","end"]},slot:{type:"integer",minimum:0,maximum:3},role:fixed("spacer-unmodeled")})),
    geometry: obj({boardWidth:num(0.005,0.5),thickness:num(0.005,0.5),tenonSize:num(0.005,0.5),tenonLength:num(0.005,0.5),holeSize:num(0.005,0.5)}),
    analysis: obj({loadNode:id,direction:{enum:["x","y","z"]},force:num(-2,2),torque:num(-2,2),gravity:num(0,2),baseAcceleration:num(0,2),frequency:num(0.05,5),duration:num(1,12),damping:num(0.001,0.3),timeStep:num(1/240,1/60),excitationStop:num(0.1,12)}),
    view: obj({deformationScale:num(1,100)})
  })
};
writeFileSync("public/schemas/tsumiki-design-v5.schema.json", `${JSON.stringify(schema,null,2)}\n`);
writeFileSync("public/examples/box-frame.tsumiki.json", serializeDesign(createDesign()));
