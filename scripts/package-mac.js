const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const version = require(path.join(root, "package.json")).version;

function stripAsarIntegrity(xml) {
  const key = "<key>ElectronAsarIntegrity</key>";
  const start = xml.indexOf(key);
  if (start === -1) return xml;
  const dictStart = xml.indexOf("<dict>", start);
  let depth = 0;
  for (let i = dictStart; i < xml.length; i += 1) {
    if (xml.startsWith("<dict>", i)) {
      depth += 1;
      i += 5;
      continue;
    }
    if (xml.startsWith("</dict>", i)) {
      depth -= 1;
      if (depth === 0) {
        return `${xml.slice(0, start)}${xml.slice(i + 7)}`;
      }
      i += 6;
    }
  }
  return xml;
}

function run(cmd, args, cwd = root) {
  const result = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: true });
  if (result.status !== 0) process.exit(result.status || 1);
}

for (const arch of ["arm64", "x64"]) {
  run("npx", [
    "--yes",
    "@electron/packager",
    ".",
    "Iris",
    "--platform=darwin",
    `--arch=${arch}`,
    "--out=dist",
    "--overwrite",
    "--asar",
    "--app-bundle-id=com.iris.eyecare",
    "--app-category-type=public.app-category.healthcare-fitness",
    "--extend-info=build/macos-info.plist",
    "--icon=build/icon.icns",
    "--ignore=dist",
    "--electron-version=45.0.0",
    "--app-copyright=Iris",
  ]);

  const appDir = path.join(root, "dist", `Iris-darwin-${arch}`);
  const plistPath = path.join(appDir, "Iris.app", "Contents", "Info.plist");
  fs.writeFileSync(plistPath, stripAsarIntegrity(fs.readFileSync(plistPath, "utf8")));

  const zipName = `Iris-macOS-${arch}-${version}.zip`;
  const zipPath = path.join(root, "dist", zipName);
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  run("tar", ["-a", "-c", "-f", path.join("..", zipName), "Iris.app"], appDir);
}
