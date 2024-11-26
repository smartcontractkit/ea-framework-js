import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsdoc from "eslint-plugin-tsdoc";
import tsParser from "@typescript-eslint/parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all
});

export default [{
    ignores: [
        "**/node_modules",
        "**/dist",
        "**/coverage",
        "scripts/generator-adapter",
        "**/.yarn",
        "**/.vscode",
    ],
}, ...compat.extends("eslint:recommended", "plugin:@typescript-eslint/recommended", "prettier"), {
    plugins: {
        "@typescript-eslint": typescriptEslint,
        tsdoc,
    },

    languageOptions: {
        parser: tsParser,
    },

    rules: {
        "tsdoc/syntax": "warn",

        "array-callback-return": ["error", {
            allowImplicit: false,
            checkForEach: true,
        }],

        "no-constant-binary-expression": "error",
        "no-constructor-return": "error",
        "no-duplicate-imports": "error",
        "no-promise-executor-return": "error",
        "no-self-compare": "error",
        "no-template-curly-in-string": "error",
        "no-unmodified-loop-condition": "error",
        "no-unreachable-loop": "error",
        "no-unused-private-class-members": "error",
        "require-atomic-updates": "error",

        "@typescript-eslint/no-unused-vars": ["warn", {
            argsIgnorePattern: "^_",
            caughtErrorsIgnorePattern: "^_"
        }],

        "capitalized-comments": ["error", "always", {
            ignoreConsecutiveComments: true,
        }],

        complexity: ["error", 25],
        curly: "error",
        "default-case-last": "error",
        "default-param-last": "error",
        eqeqeq: ["error", "smart"],
        "func-names": "error",

        "func-style": ["error", "declaration", {
            allowArrowFunctions: true,
        }],

        "grouped-accessor-pairs": ["error", "getBeforeSet"],
        "max-depth": ["error", 4],
        "max-nested-callbacks": ["error", 3],
        "max-params": ["error", 4],

        "new-cap": ["error", {
            newIsCapExceptions: ["ctor"],
        }],

        "no-caller": "error",

        "no-confusing-arrow": ["error", {
            allowParens: true,
        }],

        "no-console": ["warn"],
        "no-div-regex": "error",
        "no-eval": "error",
        "no-extend-native": "error",
        "no-extra-bind": "error",
        "no-extra-label": "error",
        "no-extra-semi": "error",
        "no-floating-decimal": "error",
        "no-implied-eval": "error",
        "no-invalid-this": "error",
        "no-labels": "error",
        "no-lonely-if": "error",
        "no-multi-assign": "error",
        "no-multi-str": "error",
        "no-nested-ternary": "error",
        "no-new": "error",
        "no-new-func": "error",
        "no-new-object": "error",
        "no-new-wrappers": "error",
        "no-param-reassign": "error",
        "no-proto": "error",
        "no-return-assign": "error",
        "no-return-await": "error",
        "no-sequences": "error",
        "no-shadow": "off",
        "@typescript-eslint/no-shadow": "error",
        "no-unneeded-ternary": "error",
        "no-useless-call": "error",
        "no-useless-computed-key": "error",
        "no-useless-concat": "error",
        "no-useless-rename": "error",
        "no-var": "error",
        "operator-assignment": ["error", "always"],
        "prefer-arrow-callback": "error",
        "prefer-const": "error",
        "prefer-exponentiation-operator": "error",
        "prefer-object-spread": "error",
        "prefer-promise-reject-errors": "error",
        "prefer-regex-literals": "error",
        "prefer-rest-params": "error",
        "prefer-spread": "error",
        "prefer-template": "error",
        "spaced-comment": ["error", "always"],
        "symbol-description": "error",
        yoda: "error",
    },
}, {
    files: ["test/**/*.ts"],

    rules: {
        "require-atomic-updates": "off",
    },
}];