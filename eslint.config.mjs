import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  //   {
  //     ignores: ['eslint.config.mjs']
  //   },
  //   eslint.configs.recommended,
  //   ...tseslint.configs.recommendedTypeChecked,
  //   eslintPluginPrettierRecommended,
  //   {
  //     languageOptions: {
  //       globals: {
  //         // ...globals.node,
  //         ...globals.jest
  //       },
  //       sourceType: 'commonjs',
  //       parserOptions: {
  //         projectService: true,
  //         tsconfigRootDir: import.meta.dirname
  //       }
  //     }
  //   },
  {
    rules: {
      // 변수 선언: var 금지, const 우선, 한 줄에 하나씩
      'no-var': 'warn',
      'prefer-const': 'warn',
      'one-var': ['warn', 'never'],

      // 미사용 변수 (TypeScript 버전으로 base 규칙 대체)
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'warn',

      // 동등 비교: === / !== 만 허용
      eqeqeq: ['warn', 'always'],

      // 중괄호: 항상 필요 (1TBS는 Prettier가 처리)
      curly: 'warn',

      // 네이밍 컨벤션
      camelcase: 'off',
      '@typescript-eslint/naming-convention': [
        'warn',
        {
          selector: 'variable',
          format: ['camelCase', 'UPPER_CASE']
        },
        {
          selector: 'function',
          format: ['camelCase']
        },
        {
          selector: 'typeLike',
          format: ['PascalCase']
        }
      ]
    }
  }
);
