import globals from 'globals';
import pluginJs from '@eslint/js';
import pluginReact from 'eslint-plugin-react';
import hooks from 'eslint-plugin-react-hooks';
import unused from 'eslint-plugin-unused-imports';
export default [{files:['apps/iphone/src/**/*.{js,jsx}','shared/sync/*.js','services/sync-relay/*.js','desktop/sync/*.cjs'],languageOptions:{globals:{...globals.browser,...globals.node},parserOptions:{ecmaVersion:'latest',sourceType:'module',ecmaFeatures:{jsx:true}}},plugins:{react:pluginReact,'react-hooks':hooks,'unused-imports':unused},settings:{react:{version:'detect'}},rules:{...pluginJs.configs.recommended.rules,'no-control-regex':'off','no-unused-vars':'off','unused-imports/no-unused-imports':'error','react-hooks/rules-of-hooks':'error','react/jsx-uses-vars':'error','react/jsx-uses-react':'error'}}];
