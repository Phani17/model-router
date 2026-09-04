import { z } from 'zod';

export const inferenceRequestSchema = z.object({
  model: z.string().min(1),
  prompt: z.string().min(1).max(20_000),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(8192).optional()
});

export type InferenceRequestDto = z.infer<typeof inferenceRequestSchema>;
