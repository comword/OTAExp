/*
 * Generates the C++ JSI spec for this Turbo Module from the TypeScript specs in
 * `ts/` and writes it into `cpp/_generated` (committed to the repo).
 *
 * Because this is a *pure C++* module there is no Android Gradle project for the
 * RN Gradle plugin to run codegen against, so we generate and commit the spec
 * ourselves. Run with: `npm run codegen:cpp`.
 */
import { existsSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { join, resolve } from 'path';

// The codegen package ships as CommonJS JS; require it directly.

const RNCodegen = require('@react-native/codegen/lib/generators/RNCodegen.js');

const {
  TypeScriptParser,
} = require('@react-native/codegen/lib/parsers/typescript/parser.js');

type SchemaType = { modules: Record<string, unknown> };

const packageJson = require('../package.json');

const libraryName: string = packageJson.codegenConfig?.name ?? 'RTNLibOTA';
const jsSrcsDir: string = packageJson.codegenConfig?.jsSrcsDir ?? 'ts';
const packageName: string | undefined =
  packageJson.codegenConfig?.android?.javaPackageName;

const moduleRoot = resolve(__dirname, '..');
const specsDir = resolve(moduleRoot, jsSrcsDir);
const outputDirectory = resolve(moduleRoot, 'cpp', '_generated');

function collectSpecFiles(): string[] {
  // Codegen only inspects files whose module name starts with `Native`.
  return readdirSync(specsDir)
    .filter(name => /^Native.+\.ts$/.test(name))
    .map(name => join(specsDir, name));
}

function buildCombinedSchema(files: string[]): SchemaType {
  const parser = new TypeScriptParser();
  const combined: SchemaType = { modules: {} };
  for (const file of files) {
    const schema = parser.parseFile(file) as SchemaType;
    Object.assign(combined.modules, schema.modules);
  }
  return combined;
}

function main(): void {
  const files = collectSpecFiles();
  if (files.length === 0) {
    throw new Error(`No Native*.ts spec files found in ${specsDir}`);
  }

  const schema = buildCombinedSchema(files);
  if (Object.keys(schema.modules).length === 0) {
    throw new Error('Codegen produced an empty schema (no TurboModules found)');
  }

  if (existsSync(outputDirectory)) {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
  mkdirSync(outputDirectory, { recursive: true });

  RNCodegen.generate(
    {
      libraryName,
      schema,
      outputDirectory,
      packageName,
      assumeNonnull: false,
      // Emit `#include "RTNLibOTAJSI.h"` style includes so the generated and
      // hand-written sources can sit side by side in cpp/_generated + cpp/common.
      useLocalIncludePaths: true,
    },
    { generators: ['modulesCxx'] },
  );

  console.log(
    `[codegen] ${libraryName}: wrote C++ JSI spec for ` +
      `${Object.keys(schema.modules).join(', ')} to ${outputDirectory}`,
  );
}

main();
