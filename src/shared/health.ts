import { literal, object, string } from 'valibot'

import type { InferOutput } from 'valibot'

export const HealthSchema = object({
  ok: literal(true),
  version: string(),
})

export type Health = InferOutput<typeof HealthSchema>
