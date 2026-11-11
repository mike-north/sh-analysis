# Version preparation

This project stays in the 0.x series until the maintainer declares the API stable.
There is no override flag. Never request a `major` bump, including for breaking
changes: use `minor` for breaking changes while the API is taking shape.

Run `pnpm exec changeset` for package changes. Tooling-only changes do not require
a changeset. When changesets reach `main`, the Release workflow opens or updates a
"Version Packages" pull request that runs `pnpm version-packages` (policy checks,
consume changesets, update versions, append to `CHANGELOG.md`). Merging that pull
request publishes to npm. Nobody types a version or dispatches a workflow.

CI rejects major declarations, public manifests outside 0.x, and Changesets
release plans outside 0.x. Release repeats these checks before npm publication.
