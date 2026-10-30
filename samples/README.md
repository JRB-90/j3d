# Samples

Two small apps built on J3D's released packages, the way a project of your own would use them. Each opens a file, draws it and names the part you click.

| Folder | What it is |
|---|---|
| [`vite`](vite) | A plain TypeScript app on `@j3d/viewer` |
| [`blazor`](blazor) | A Blazor Web App on `J3D.Blazor`, as `dotnet new blazor --interactivity WebAssembly` gives it, with prerendering |

[`docs/library.md`](../docs/library.md) explains the steps.

## Running them

They install from a [release](https://github.com/JRB-90/j3d/releases), not from this repository's source, so they run on their own:

```bash
cd samples/vite
```

```bash
npm install
```

```bash
npm run dev
```

The Blazor sample needs the `.nupkg` in its `packages` folder first:

```bash
cd samples/blazor
```

```bash
curl -L --create-dirs -o packages/J3D.Blazor.0.1.0.nupkg https://github.com/JRB-90/j3d/releases/download/v0.1.0/J3D.Blazor.0.1.0.nupkg
```

```bash
dotnet run --project BlazorSample
```

## How they're tested

`tests/packaging/samples.mjs` copies each one out of the repository, installs it, builds it for production and loads a fixture and clicks a part in a headless browser, on every pull request and before and after each release.
