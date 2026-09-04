import { z } from 'zod';

export const routerRequestSchema = z.object({
  prompt: z.string().min(1).max(20_000),
  models: z.array(z.string().min(1)).min(1).max(4),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(8192).optional()
}).superRefine((value, context) => {
  if (new Set(value.models).size !== value.models.length) {
    context.addIssue({ code: 'custom', path: ['models'], message: 'Models must not contain duplicates' });
  }
});

export type RouterRequestDto = z.infer<typeof routerRequestSchema>;

