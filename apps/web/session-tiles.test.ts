import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sessionHues, sessionTiles } from "./session-tiles";
import { ExperienceScope } from "../../packages/protocol/experiences";
const scope = (label: string, index: number) => ExperienceScope.parse({id:`00000000-0000-4000-8000-${String(index).padStart(12,"0")}`,profileId:"00000000-0000-4000-8000-000000000000",label,purpose:"Test",createdAt:`2026-11-05T00:00:0${index}.000Z`});
test("sessions use creation order hues, word initials and a distinct later duplicate", () => {
 const scopes = [scope("Weekly plan",0),scope("Study",1),scope("Work",2),scope("Work",3)];
 const tiles = sessionTiles([...scopes].reverse());
 assert.deepEqual(scopes.map(s=>tiles.get(s.id)),[{text:"WP",hue:"sky"},{text:"S",hue:"rose"},{text:"W",hue:"sage"},{text:"Wo",hue:"amber"}]);
});
test("all twelve session token pairs exceed 4.5 to 1 contrast", () => {
 const theme = readFileSync(new URL("./styles/theme.css",import.meta.url),"utf8");
 const luminance = (hex:string) => {
  const rgb = hex.match(/[a-f\d]{2}/gi)!.map(c=>parseInt(c,16)/255).map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4);
  return rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722;
 };
 for (const hue of sessionHues) {
  const values = [...theme.matchAll(new RegExp(`--color-session-${hue}-(?:bg|ink): (#[a-f0-9]+)`,"g"))].map(m=>luminance(m[1]));
  assert.equal(values.length,4);
  for (const i of [0,2]) assert((Math.max(values[i],values[i+1])+0.05)/(Math.min(values[i],values[i+1])+0.05)>=4.5,hue);
 }
});
