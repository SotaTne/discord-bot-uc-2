import { describe, expect, it } from "vitest";
import { readEnvValue, upsertEnvLine } from "./env-file";

describe("upsertEnvLine", () => {
  it("あれば、その行だけ書き換える。ほかの行・コメントは、そのまま", () => {
    expect(upsertEnvLine("# メモ\nGAS_DEPLOYMENT_ID=abc\nCRON_SECRET=old\nOTHER=1\n", "CRON_SECRET", "new")).toBe("# メモ\nGAS_DEPLOYMENT_ID=abc\nCRON_SECRET=new\nOTHER=1\n");
  });

  it("なければ、末尾に足す（末尾に改行がなくても、行が、つながらない）", () => {
    expect(upsertEnvLine("A=1\n", "CRON_SECRET", "new")).toBe("A=1\nCRON_SECRET=new\n");
    expect(upsertEnvLine("A=1", "CRON_SECRET", "new")).toBe("A=1\nCRON_SECRET=new\n");
    expect(upsertEnvLine("", "CRON_SECRET", "new")).toBe("CRON_SECRET=new\n");
  });

  it("名前が前方一致するだけの、別の行（CRON_SECRET_OLD など）は、書き換えない", () => {
    expect(upsertEnvLine("CRON_SECRET_OLD=x\n", "CRON_SECRET", "new")).toBe("CRON_SECRET_OLD=x\nCRON_SECRET=new\n");
  });
});

describe("readEnvValue", () => {
  it("KEY の値を読む。ない・空は、null。前方一致だけの別の名前は、読まない", () => {
    expect(readEnvValue("A=1\nCRON_SECRET=abc\n", "CRON_SECRET")).toBe("abc");
    expect(readEnvValue("CRON_SECRET=\n", "CRON_SECRET")).toBeNull();
    expect(readEnvValue("A=1\n", "CRON_SECRET")).toBeNull();
    expect(readEnvValue("CRON_SECRET_OLD=x\n", "CRON_SECRET")).toBeNull();
  });
});
