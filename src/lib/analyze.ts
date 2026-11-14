import JSZip from 'jszip';

export interface Analysis {
  root: string;
  fileCount: number;
  isAndroid: boolean;
  hasWrapper: boolean;
  dsl: 'groovy' | 'kotlin' | null;
  appModule: string | null;
  applicationId: string | null;
  namespace: string | null;
  compileSdk: number | null;
  minSdk: number | null;
  targetSdk: number | null;
  agpVersion: string | null;
  gradleVersion: string | null;
  javaVersion: string | null;
  kotlin: boolean;
  recommendedJdk: string;
  modules: string[];
  warnings: string[];
}

const num = (re: RegExp, s: string) => {
  const m = s.match(re);
  return m ? Number(m[1]) : null;
};
const str = (re: RegExp, s: string) => {
  const m = s.match(re);
  return m ? m[1] : null;
};

export async function analyzeZip(file: File): Promise<Analysis> {
  const zip = await JSZip.loadAsync(file);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir && !n.startsWith('__MACOSX') && !n.includes('/.DS_Store'));
  const read = async (n: string) => (zip.file(n) ? await zip.file(n)!.async('string') : '');
  const warnings: string[] = [];

  const settings = names
    .filter((n) => /(^|\/)settings\.gradle(\.kts)?$/.test(n))
    .sort((a, b) => a.split('/').length - b.split('/').length)[0];
  const gradlew = names.filter((n) => /(^|\/)gradlew$/.test(n)).sort((a, b) => a.split('/').length - b.split('/').length)[0];
  const anchor = settings || gradlew;
  const root = anchor ? anchor.slice(0, anchor.lastIndexOf('/') + 1) : '';
  const dsl = settings ? (settings.endsWith('.kts') ? 'kotlin' : 'groovy') : null;

  const buildFiles = names.filter((n) => n.startsWith(root) && /(^|\/)build\.gradle(\.kts)?$/.test(n) && !n.includes('/build/'));
  const modules = buildFiles
    .map((n) => n.slice(root.length, n.lastIndexOf('/') + 1).replace(/\/$/, ''))
    .filter((m) => m !== '');

  let appModule: string | null = null;
  let appSrc = '';
  for (const f of buildFiles) {
    const c = await read(f);
    const isRootDecl = f === root + 'build.gradle' || f === root + 'build.gradle.kts';
    if (isRootDecl && /apply\s*\(?\s*false/.test(c)) continue;
    if (/com\.android\.application|android\.application|plugins\.android\.application/.test(c)) {
      appModule = f.slice(root.length, f.lastIndexOf('/') + 1).replace(/\/$/, '');
      appSrc = c;
      break;
    }
  }

  const rootBuild = (await read(root + 'build.gradle')) + (await read(root + 'build.gradle.kts'));
  const toml = await read(root + 'gradle/libs.versions.toml');
  const wrapperProps = await read(root + 'gradle/wrapper/gradle-wrapper.properties');

  const agpVersion =
    str(/com\.android\.tools\.build:gradle:([\d.]+[\w-]*)/, rootBuild) ||
    str(/id\s*\(?\s*["']com\.android\.application["']\s*\)?\s*version\s*["']([\d.]+[\w-]*)["']/, rootBuild) ||
    str(/^\s*(?:agp|androidGradlePlugin|android-gradle-plugin|androidGradle)\s*=\s*"([\d.]+[\w-]*)"/m, toml);
  const gradleVersion = str(/gradle-([\d.]+(?:-rc-\d+)?)-(?:bin|all)\.zip/, wrapperProps);

  const javaRaw =
    str(/JavaVersion\.VERSION_(\d+(?:_\d+)?)/, appSrc) ||
    str(/jvmToolchain\s*\(\s*(\d+)\s*\)/, appSrc) ||
    str(/JvmTarget\.JVM_(\d+(?:_\d+)?)/, appSrc) ||
    str(/jvmTarget\s*=\s*["']([\d.]+)["']/, appSrc);
  const javaVersion = javaRaw ? javaRaw.replace('_', '.') : null;

  const agpMajor = agpVersion ? Number(agpVersion.split('.')[0]) : null;
  let recommendedJdk = '17';
  if (agpMajor !== null) {
    if (agpMajor >= 8) recommendedJdk = '17';
    else if (agpMajor >= 7) recommendedJdk = '11';
    else recommendedJdk = '8';
  }
  if (agpVersion && /^8\.(1[0-9]|[89])/.test(agpVersion) && javaVersion === '21') recommendedJdk = '21';

  const isAndroid = appModule !== null;
  if (!settings) warnings.push('No settings.gradle(.kts) found at the project root.');
  if (!gradlew) warnings.push('No Gradle wrapper (gradlew) — the agent will fall back to an installed Gradle.');
  if (!isAndroid) warnings.push('No module applies com.android.application — this may not be an Android app project.');
  if (names.some((n) => /(^|\/)build\/(intermediates|outputs|tmp)\//.test(n))) warnings.push('Zip contains build/ output folders — remove them to shrink uploads.');
  if (names.some((n) => /(^|\/)\.gradle\//.test(n))) warnings.push('Zip contains a .gradle cache folder — safe to exclude.');
  if (names.some((n) => /(^|\/)local\.properties$/.test(n))) warnings.push('local.properties is included — the agent will overwrite sdk.dir.');

  return {
    root,
    fileCount: names.length,
    isAndroid,
    hasWrapper: !!gradlew,
    dsl,
    appModule,
    applicationId: str(/applicationId\s*[=(]?\s*["']([\w.]+)["']/, appSrc),
    namespace: str(/namespace\s*[=(]?\s*["']([\w.]+)["']/, appSrc),
    compileSdk: num(/compileSdk(?:Version)?\s*[=(]?\s*(\d+)/, appSrc),
    minSdk: num(/minSdk(?:Version)?\s*[=(]?\s*(\d+)/, appSrc),
    targetSdk: num(/targetSdk(?:Version)?\s*[=(]?\s*(\d+)/, appSrc),
    agpVersion,
    gradleVersion,
    javaVersion,
    kotlin: names.some((n) => n.endsWith('.kt')) || /kotlin/.test(appSrc),
    recommendedJdk,
    modules,
    warnings,
  };
}
