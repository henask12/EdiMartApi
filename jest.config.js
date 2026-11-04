/** @type {import('jest').Config} */
module.exports = {
  rootDir: ".",
  testEnvironment: "node",
  testMatch: ["<rootDir>/src/**/*.spec.ts", "<rootDir>/test/**/*.e2e-spec.ts"],
  transform: { "^.+\.ts$": ["ts-jest", { tsconfig: "tsconfig.test.json", diagnostics: false }] },
  globalSetup: "<rootDir>/test/global-setup.ts",
  globalTeardown: "<rootDir>/test/global-teardown.ts",
  setupFiles: ["<rootDir>/test/env.ts"],
  testTimeout: 60000,
  maxWorkers: 1,
};
