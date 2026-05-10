import { z } from 'zod'

const nonEmptyStringSchema = z.string().trim().min(1)
const optionalStringSchema = nonEmptyStringSchema.optional()
const nameField = {
  name: nonEmptyStringSchema,
}
const versionField = {
  version: nonEmptyStringSchema,
}
const descriptionField = {
  description: nonEmptyStringSchema,
}
const optionalDescriptionVersionFields = {
  description: optionalStringSchema,
  version: optionalStringSchema,
}
const manifestIdentityFields = {
  ...nameField,
  ...descriptionField,
  ...versionField,
}

export const pluginAuthorSchema = z
  .strictObject({
    ...nameField,
    email: optionalStringSchema,
  })

export const pluginMarketplaceMetadataSchema = z.strictObject({
  ...descriptionField,
  ...versionField,
  pluginRoot: nonEmptyStringSchema,
})

export const codexPluginInterfaceSchema = z.strictObject({
  displayName: nonEmptyStringSchema,
  shortDescription: nonEmptyStringSchema,
  developerName: nonEmptyStringSchema,
  category: nonEmptyStringSchema,
})

export const codexMarketplaceInterfaceSchema = z.strictObject({
  displayName: nonEmptyStringSchema,
})

export const claudePluginManifestSchema = z
  .strictObject({
    ...manifestIdentityFields,
    author: pluginAuthorSchema.optional(),
    commands: z.array(nonEmptyStringSchema).optional(),
    agents: z.array(nonEmptyStringSchema).optional(),
  })

export const claudeMarketplacePluginSchema = z
  .strictObject({
    ...nameField,
    source: nonEmptyStringSchema,
    ...optionalDescriptionVersionFields,
    tags: z.array(nonEmptyStringSchema).optional(),
  })

export const claudeMarketplaceManifestSchema = z
  .strictObject({
    ...nameField,
    owner: pluginAuthorSchema,
    metadata: pluginMarketplaceMetadataSchema,
    plugins: z.array(claudeMarketplacePluginSchema),
  })

export const codexPluginManifestSchema = z
  .strictObject({
    ...manifestIdentityFields,
    author: pluginAuthorSchema.optional(),
    skills: nonEmptyStringSchema.optional(),
    mcpServers: nonEmptyStringSchema.optional(),
    apps: nonEmptyStringSchema.optional(),
    interface: codexPluginInterfaceSchema,
  })

export const codexMarketplacePluginSchema = z
  .strictObject({
    ...nameField,
    source: z.strictObject({
      source: z.literal('local'),
      path: nonEmptyStringSchema,
    }),
    policy: z.strictObject({
      installation: z.enum(['AVAILABLE', 'INSTALLED_BY_DEFAULT', 'NOT_AVAILABLE']),
      authentication: z.enum(['ON_INSTALL', 'ON_USE']),
    }),
    category: nonEmptyStringSchema,
  })

export const codexMarketplaceManifestSchema = z
  .strictObject({
    ...nameField,
    interface: codexMarketplaceInterfaceSchema,
    plugins: z.array(codexMarketplacePluginSchema),
  })

export const cursorPluginManifestSchema = z
  .strictObject({
    ...manifestIdentityFields,
    author: pluginAuthorSchema.optional(),
    rules: nonEmptyStringSchema.optional(),
    skills: nonEmptyStringSchema.optional(),
    agents: nonEmptyStringSchema.optional(),
    commands: nonEmptyStringSchema.optional(),
    hooks: nonEmptyStringSchema.optional(),
    mcpServers: nonEmptyStringSchema.optional(),
  })

export const cursorMarketplacePluginSchema = z
  .strictObject({
    ...nameField,
    source: nonEmptyStringSchema,
    ...optionalDescriptionVersionFields,
    author: pluginAuthorSchema.optional(),
    keywords: z.array(nonEmptyStringSchema).optional(),
  })

export const cursorMarketplaceManifestSchema = z
  .strictObject({
    ...nameField,
    owner: pluginAuthorSchema,
    metadata: pluginMarketplaceMetadataSchema,
    plugins: z.array(cursorMarketplacePluginSchema),
  })

export type ClaudePluginManifest = z.infer<typeof claudePluginManifestSchema>
export type ClaudeMarketplaceManifest = z.infer<typeof claudeMarketplaceManifestSchema>
export type CodexPluginManifest = z.infer<typeof codexPluginManifestSchema>
export type CodexMarketplaceManifest = z.infer<typeof codexMarketplaceManifestSchema>
export type CodexMarketplacePlugin = z.infer<typeof codexMarketplacePluginSchema>
export type CursorPluginManifest = z.infer<typeof cursorPluginManifestSchema>
export type CursorMarketplaceManifest = z.infer<typeof cursorMarketplaceManifestSchema>
