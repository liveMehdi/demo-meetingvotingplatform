import { z } from "zod";

export function parseData<T>(
  schema: z.ZodType<T>,
  data: unknown,
  message: string,
): T {
  const result = schema.safeParse(data);
  if (!result.success) throw new Error(message);
  return result.data;
}

export async function readResponse<T>(
  response: Response,
  schema: z.ZodType<T>,
  message: string,
): Promise<T> {
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error(message);
  }
  return parseData(schema, data, message);
}

const errorDetailSchema = z.object({ detail: z.string() });

export async function readErrorDetail(
  response: Response,
): Promise<string | undefined> {
  const result = errorDetailSchema.safeParse(
    await response.json().catch(() => null),
  );
  return result.success ? result.data.detail : undefined;
}
