#!/usr/bin/env pwsh
# Thin wrapper so you can run: .\pn install / .\pn dev
& npx --yes pnpm@10.12.1 @args
exit $LASTEXITCODE
