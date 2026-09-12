#!/usr/bin/env node
/**
 * Construit l'APK Android de TelecomStock Pro.
 *
 *  - localise le SDK Android et Java,
 *  - crée un keystore de signature si absent,
 *  - télécharge le wrapper Gradle au besoin,
 *  - lance assembleRelease et rapatrie l'APK dans dist/.
 *
 * Usage : npm run build:apk
 */
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const ANDROID = path.join(ROOT, 'android');
const DIST = path.join(ROOT, 'dist');

const log = m => console.log(m);
const die = m => { console.error(`\n✗ ${m}\n`); process.exit(1); };

/* ---------- localisation du SDK ---------- */

function findSdk() {
    const candidates = [
        process.env.ANDROID_HOME,
        process.env.ANDROID_SDK_ROOT,
        path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk'),
        path.join(os.homedir(), 'Android', 'Sdk'),
        path.join(os.homedir(), 'Library', 'Android', 'sdk')
    ].filter(Boolean);

    for (const dir of candidates) {
        if (fs.existsSync(path.join(dir, 'platforms'))) return dir;
    }
    die('SDK Android introuvable.\n  Installez Android Studio, ou définissez ANDROID_HOME.');
}

function findJava() {
    if (process.env.JAVA_HOME && fs.existsSync(process.env.JAVA_HOME)) return process.env.JAVA_HOME;
    // Repli : déduire JAVA_HOME depuis le java du PATH
    try {
        const out = execSync('java -XshowSettings:properties -version 2>&1', { encoding: 'utf8' });
        const m = out.match(/java\.home\s*=\s*(.+)/);
        if (m) return m[1].trim();
    } catch { /* java absent */ }
    die('Java (JDK 17+) introuvable. Installez un JDK et définissez JAVA_HOME.');
}

/* ---------- keystore ---------- */

function ensureKeystore(javaHome) {
    const keystore = path.join(ANDROID, 'telecomstock.keystore');
    if (fs.existsSync(keystore)) {
        log('  Keystore existant réutilisé');
        return keystore;
    }
    log('  Création du keystore de signature…');
    const keytool = path.join(javaHome, 'bin', process.platform === 'win32' ? 'keytool.exe' : 'keytool');
    const r = spawnSync(keytool, [
        '-genkeypair', '-v',
        '-keystore', keystore,
        '-alias', 'telecomstock',
        '-keyalg', 'RSA', '-keysize', '2048',
        '-validity', '10000',
        '-storepass', 'telecomstock',
        '-keypass', 'telecomstock',
        '-dname', 'CN=TelecomStock Pro, OU=Ventes, O=TelecomStock, L=Ouagadougou, C=BF'
    ], { stdio: 'pipe', encoding: 'utf8' });

    if (r.status !== 0) die(`Création du keystore impossible :\n${r.stderr || r.stdout}`);
    return keystore;
}

/* ---------- sélection de Gradle ---------- */

/**
 * Le plugin Android 8.1.4 exige Gradle 8.x ; un Gradle 9 présent sur le PATH
 * fait échouer la compilation. On cherche donc explicitement une version 8.
 */
function findGradle() {
    const isWin = process.platform === 'win32';
    const bin = isWin ? 'gradle.bat' : 'gradle';

    const roots = [
        process.env.TS_GRADLE_HOME,
        ...['8.9', '8.8', '8.7', '8.6', '8.5'].flatMap(v => [
            path.join('C:', 'Gradle', `gradle-${v}`),
            path.join(os.homedir(), 'gradle', `gradle-${v}`),
            `/opt/gradle/gradle-${v}`
        ])
    ].filter(Boolean);

    for (const root of roots) {
        const exe = path.join(root, 'bin', bin);
        if (fs.existsSync(exe)) return { cmd: exe, label: path.basename(root) };
    }

    // Repli : le gradle du PATH, uniquement s'il est en 8.x
    const probe = spawnSync(bin, ['--version'], { encoding: 'utf8', shell: true });
    if (probe.status === 0) {
        const m = (probe.stdout || '').match(/Gradle\s+(\d+)\.(\d+)/);
        if (m && Number(m[1]) === 8) return { cmd: bin, label: `système ${m[1]}.${m[2]}` };
        if (m) {
            die(`Gradle ${m[1]}.${m[2]} détecté, incompatible avec le plugin Android 8.1.4.\n`
                + `  Installez Gradle 8.9 puis relancez, ou définissez TS_GRADLE_HOME\n`
                + `  vers un dossier Gradle 8.x.`);
        }
    }
    die('Gradle introuvable. Installez Gradle 8.9 (https://gradle.org/releases/).');
}

/* ---------- construction ---------- */

function build() {
    log('\nConstruction de l\'APK TelecomStock Pro');
    log('─'.repeat(46));

    const sdk = findSdk();
    const javaHome = findJava();
    const gradle = findGradle();
    log(`  SDK Android : ${sdk}`);
    log(`  Java        : ${javaHome}`);
    log(`  Gradle      : ${gradle.label}`);

    fs.writeFileSync(path.join(ANDROID, 'local.properties'),
        `sdk.dir=${sdk.replace(/\\/g, '\\\\')}\n`);

    const keystore = ensureKeystore(javaHome);

    log('\n  Compilation en cours…\n');

    const r = spawnSync(gradle.cmd, ['assembleRelease', '--no-daemon'], {
        cwd: ANDROID,
        stdio: 'inherit',
        shell: true,
        env: {
            ...process.env,
            JAVA_HOME: javaHome,
            ANDROID_HOME: sdk,
            ANDROID_SDK_ROOT: sdk,
            TS_KEYSTORE: keystore,
            TS_KEYSTORE_PASSWORD: 'telecomstock',
            TS_KEY_ALIAS: 'telecomstock',
            TS_KEY_PASSWORD: 'telecomstock'
        }
    });

    if (r.status !== 0) die('La compilation Gradle a échoué (voir le journal ci-dessus).');

    const built = path.join(ANDROID, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
    if (!fs.existsSync(built)) die(`APK introuvable à l'emplacement attendu :\n  ${built}`);

    fs.mkdirSync(DIST, { recursive: true });
    const version = require(path.join(ROOT, 'package.json')).version;
    const target = path.join(DIST, `TelecomStock-Pro-${version}.apk`);
    fs.copyFileSync(built, target);

    const sizeMo = (fs.statSync(target).size / 1024 / 1024).toFixed(1);
    log('\n' + '─'.repeat(46));
    log(`✓ APK généré : ${target}`);
    log(`  Taille : ${sizeMo} Mo`);
    log('─'.repeat(46) + '\n');
}

build();
