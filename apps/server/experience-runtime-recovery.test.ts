import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { experienceFixture } from "./testing/experiences.ts";

for (const terminal of [false, true])
  test(
    `SIGKILL ${terminal ? "after terminal commit" : "during an unsafe effect"} never replays provider or effects`,
    { timeout: 20000 },
    async (t) => {
      const dir = await mkdtemp(join(tmpdir(), "gaia-experience-crash-"));
      const requestId = randomUUID();
      const script = `
 import { createPi } from './apps/server/pi.ts';
 import { createAuth } from './apps/server/auth.ts';
 import { openDatabase } from './apps/server/server.ts';
 import { defineExtension,defineTool } from '@earendil-works/pi-durable';
 import { fauxProvider,fauxAssistantMessage,fauxToolCall } from '@earendil-works/pi-ai';
 import { appendFile } from 'node:fs/promises';
 import { join } from 'node:path';
 import { randomUUID } from 'node:crypto';
 process.on("disconnect",()=>process.exit(0));
 const deadline=setTimeout(()=>process.exit(1),15000);deadline.unref();
 process.on("message",value=>{if(value==="crash")process.kill(process.pid,"SIGKILL");if(value==="close")process.exit(0);});
 const dir=${JSON.stringify(dir)};
 const db=await openDatabase(dir),auth=createAuth(db);
 const faux=fauxProvider({provider:'openai-codex',models:[{id:'gpt-6.1-sol',reasoning:true}],tokensPerSecond:100000});auth.models.setProvider(faux.provider);
 const extension=defineExtension({name:'effect-fixture',tools:[defineTool({name:'effect',description:'Owned scratch effect',parameters:{type:'object',properties:{},additionalProperties:false},replay:'unsafe',async execute(){await appendFile(join(dir,'effect.txt'),'once\\n');process.stdout.write('EFFECT\\n');${terminal ? "return {output:[{type:'text',text:'Scratch write completed'}]};" : "await new Promise(()=>{});throw new Error('unreachable');"}}})]});
 const pi=await createPi(join(dir,'pi.sqlite'),auth,[],{}, {experiencesEnabled:true,experiences:{extensions:[extension]}});
 const proposal=await pi.experiences.create({requestId:${JSON.stringify(requestId)},plan:{layout:'single',title:'Crash fixture',assistantName:'Gaia',purpose:'Crash fixture',scopes:[{label:'Main',purpose:'Scratch crash fixture'}]}});
 const profile=await pi.experiences.resolve(proposal.id);const state=await profile.confirm(1);
 faux.setResponses([fauxAssistantMessage(fauxToolCall('effect',{}),{stopReason:'toolUse'}),fauxAssistantMessage('Durable actual result')]);
 const job=await profile.send(state.scopes[0].id,{requestId:randomUUID(),text:'Owned effect request'});
 process.stdout.write('ADMITTED '+JSON.stringify(job)+'\\n');
 ${terminal ? "await profile.wait(job.jobId);process.stdout.write('TERMINAL\\n');" : ""}
 setInterval(()=>{},1000);
 `;
      const child = spawn(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "--eval", script],
        {
          cwd: process.cwd(),
          stdio: ["ignore", "pipe", "pipe", "ipc"],
        },
      );
      const { stdout, stderr } = child;
      assert(stdout && stderr);
      let output = "",
        error = "";
      stderr.on("data", (chunk) => {
        error += String(chunk);
      });
      const reached = new Promise<void>((resolve, reject) => {
        stdout.on("data", (chunk) => {
          output += String(chunk);
          if (output.includes(terminal ? "TERMINAL\n" : "EFFECT\n")) resolve();
        });
        child.once("exit", () => reject(new Error(error || output)));
      });
      t.after(async () => {
        if (child.connected) {
          const closed = once(child, "close");
          child.send("close");
          await closed;
        }
      });
      await reached;
      const exited = once(child, "exit");
      child.send("crash");
      await exited;
      const f = await experienceFixture(t, { directory: dir });
      assert.equal(f.faux.state.callCount, 0);
      assert.equal(await readFile(join(dir, "effect.txt"), "utf8"), "once\n");
      const s = await f.state(requestId);
      assert.equal(s.jobs.length, 1);
      const job = s.jobs[0];
      assert.equal(job.state.kind, terminal ? "completed" : "uncertain");
      const runtime = await f.pi.experiences!.resolve(requestId);
      const stored = await runtime.read();
      assert.equal(
        stored.scopes[0].ledger.filter((entry) => entry.kind === "result")
          .length,
        1,
      );
      if (terminal) {
        const replay = await f.send(
          requestId,
          job.scopeId,
          "Owned effect request",
          job.requestId,
        );
        assert.equal(replay.jobId, job.id);
        assert.equal(f.faux.state.callCount, 0);
        assert.equal(stored.jobs[0].receipts.length, 1);
      } else {
        assert.equal(
          (
            await f.request(`experiences/${requestId}/jobs/${job.id}/retry`, {
              requestId: randomUUID(),
            })
          ).status,
          409,
        );
        f.faux.setResponses([
          fauxAssistantMessage("Explicit retry without repeating effect"),
        ]);
        const retry = await f.request(
          `experiences/${requestId}/jobs/${job.id}/retry`,
          { requestId: randomUUID(), repeatUncertain: true },
        );
        assert.equal(retry.status, 202, await retry.clone().text());
        const admitted = await retry.json();
        await f.settled(requestId, admitted.jobId);
        assert.equal(await readFile(join(dir, "effect.txt"), "utf8"), "once\n");
        assert.equal((await f.state(requestId)).jobs.length, 2);
      }
    },
  );
