export type AppRole = 'USER' | 'EVALUATOR' | 'ADMIN';
export interface RequestIdentity { actorId: string; tenantId: string; roles: AppRole[]; authType: 'OIDC' | 'LOCAL'; }
