import { z } from "zod";

// checking the download format only, not the hashes or completeness of the history
const digestSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const checkpointSchema = z.looseObject({
  format: z.literal("voting-audit-checkpoint-v1"),
  chain_id: z.string().regex(/^[0-9a-f-]{36}$/),
  genesis_digest: digestSchema,
  sequence: z.number().int().nonnegative(),
  event_digest: digestSchema,
});

export const auditExportSchema = z.looseObject({
  format: z.literal("voting-audit-export-v1"),
  events: z.array(z.unknown()),
  checkpoint: checkpointSchema,
});
