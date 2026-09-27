/**
 * `content-match.ts` is now a thin re-export shim: the LIKE-parity matcher moved
 * to `@life/shared` (AGENTS.md Contract 2 no-fork rule, `SPEC-service-kernel`
 * "Shared primitives"). Every existing call site (notes.service.ts) and test
 * keeps compiling unchanged against this path.
 */
export { likeMatch } from '@life/shared';
