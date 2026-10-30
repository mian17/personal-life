# SPEC-ops-registry-vocabulary — module id `ops-registry-vocabulary`, body extracted verbatim from the frozen capability map `docs/specs/SPEC-ops-all-services.md` §1.1.1

#### 1.1.1 `ops-registry-vocabulary` — the field vocabulary (E2)

- **E2 — object and array-of-object fields.** `FieldSpec.type` gains `'object'`
  and `'object[]'`; `FieldSpec` gains `properties?: Record<string, FieldSpec>`,
  required exactly when the type is `object`/`object[]`, forbidden otherwise,
  recursive (an `object[]`'s `properties` describe one element, which may itself
  nest — saved-meal items nest `nutrients` one level down). Derivations:
  validator — `object` is a plain non-null object with no unknown keys (closed key
  set), required properties present, every supplied value checked recursively;
  `object[]` is an array of such objects; failure `field` paths are dotted/indexed
  (`items.0.nutrients.sodium`) and render through the existing canonical shape.
  Wire — nested values pass through as supplied JSON in the request body;
  `object`/`object[]` fields are body-only, legal on `create`/`update` kinds only
  (the query-bearing `list` kind keeps flat closed types). MCP `inputSchema` —
  `object` → `{type: 'object', properties, required, additionalProperties: false}`,
  `object[]` → `{type: 'array', items: <object schema>}`. CLI —
  `--field '<json>'` with `JSON.parse`; a parse failure renders the canonical
  validation message. `null` stays unrepresentable (no null-means-clear, §1.7).
