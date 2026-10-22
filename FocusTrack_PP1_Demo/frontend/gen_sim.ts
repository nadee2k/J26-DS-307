import { generateStudy } from "./lib/sim/generate";
import { writeFileSync } from "fs";
const study = generateStudy(2026, 22, 6);
writeFileSync("/tmp/focustrack_simulated_study_seed2026.json", JSON.stringify(study));
console.log("done", study.participants.length, study.sessions.length);
