import {
  commitReservation,
  consumeEvent,
  reserveEvent,
  rollbackReservation,
  USAGE,
} from "../../src/approval/index.ts";
import { LocalDirFS } from "../../src/fs/local-dir-fs.ts";
import { pyJson, readJson } from "../../src/runtime.ts";

const [operation, root, eventPath] = process.argv.slice(2);
if (!root || !eventPath) throw new Error("Missing arguments");
const fs = new LocalDirFS(root);
const event = await readJson(fs, eventPath);
const pendingPath = `${USAGE}/.${event.id}.pending`;
const finalPath = `${USAGE}/${event.id}.json`;
try {
  let result: unknown;
  if (operation === "reserve") {
    const r = await reserveEvent(fs, event, "gushi-gousishi");
    result = {
      entry: r.entry,
      pending_path: fs.displayPath(r.pendingPath),
      final_path: fs.displayPath(r.finalPath),
    };
  } else if (operation === "commit")
    result = await commitReservation(fs, {
      entry: await readJson(fs, pendingPath),
      pendingPath,
      finalPath,
    });
  else if (operation === "rollback") {
    await rollbackReservation(fs, { entry: {}, pendingPath, finalPath });
    result = null;
  } else result = await consumeEvent(fs, event, "gushi-gousishi");
  console.log(pyJson(result));
} catch (error) {
  console.error(`ERROR: ${(error as Error).message}`);
  process.exitCode = 2;
}
