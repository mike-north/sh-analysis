/** CI uses the same version ceiling as publication without requiring a dispatch identity. */
import { checkVersions } from "./check-release.ts";
await checkVersions();
