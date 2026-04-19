import path from 'node:path'
import process from 'node:process'
import { defineCommand, showUsage } from 'citty'
import { removeIfExists } from '../../lib/fs'
import { createPluginBundle } from '../../lib/plugin-bundle'
import { LOCAL_PLUGIN_POLICY } from '../../lib/registry'
import {
  formatPluginValidationMessages,
  PluginSubmissionValidationError,
  validatePluginBundle,
} from '../../lib/plugin-submission-validation'

const command = defineCommand({
  meta: {
    name: 'bundle',
    description: 'Build a local plugin ZIP bundle and validate it against the canonical local policy.',
  },
  args: {
    dir: {
      type: 'positional',
      description: 'Plugin directory to bundle (defaults to current directory)',
      required: false,
    },
    out: {
      type: 'string',
      description: 'Output ZIP path (defaults to <plugin-dir>/<plugin-id>-<version>.zip)',
    },
    help: {
      type: 'boolean',
      alias: 'h',
      description: 'Show help',
      default: false,
    },
  },
  async run({ args }) {
    if (args.help) return showUsage(command)

    const directory = path.resolve(args.dir ?? process.cwd())
    const policy = LOCAL_PLUGIN_POLICY

    const bundle = await createPluginBundle({
      dir: directory,
      policy,
      outFile: args.out ? path.resolve(args.out) : undefined,
      temporary: false,
    })

    try {
      const validation = await validatePluginBundle(bundle.zipBytes, policy)
      if (validation.warnings.length) {
        console.log('Warnings:')
        for (const warning of validation.warnings) {
          console.log(`- ${warning}`)
        }
      }
      console.log(`Bundle ready: ${bundle.bundlePath}`)
      console.log(`Files: ${validation.fileCount}`)
      console.log(`ZIP size: ${validation.zipBytes} bytes`)
    } catch (error) {
      await removeIfExists(bundle.bundlePath)
      if (error instanceof PluginSubmissionValidationError) {
        const warningBlock = error.warnings.length
          ? `\nWarnings:\n${formatPluginValidationMessages(error.warnings)}`
          : ''
        throw new Error(
          `Plugin bundle failed validation:\n${formatPluginValidationMessages(error.errors)}${warningBlock}`
        )
      }
      throw error
    }
  },
})

export default command
