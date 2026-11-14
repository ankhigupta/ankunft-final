import main from "../src/data/qa-gold.json";
import second from "../src/data/qa-gold-heldout.json";
import { formatReport, runEval, type GoldCase } from "../src/lib/qa/eval";

const TODAY = "2026-11-14";
console.log(formatReport("Main set", runEval(main.cases as GoldCase[], TODAY)));
console.log();
console.log(formatReport("Second set (written before the window; used for tuning earlier, so not independent)", runEval(second.cases as GoldCase[], TODAY)));
