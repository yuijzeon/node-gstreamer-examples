import { JestConfigWithTsJest } from 'ts-jest';

const config: JestConfigWithTsJest = {
  rootDir: 'src',
  testEnvironment: 'node',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  testRegex: '.*\\.ts$',
};
export default config;
