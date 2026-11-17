# Ruwen Serif 离线分包

此处仅记录块 1 的一次性操作，应用构建与运行不调用这些工具。全部生成的 woff2、CSS 和 OFL 在 `apps/web/public/fonts/ruwen-serif/`。保留完整字符覆盖，由 unicode-range 按需加载。

来源：[Adobe Source Han Serif](https://github.com/adobe-fonts/source-han-serif)，release 提交 `7889f11bf31170b5d092a083b357c8c8130f89e0`，SC OTF 2.003 Regular / SemiBold。使用该提交的 LICENSE.txt，原样保存为 OFL.txt。生成前改 name/CFF 字体名称，保留版权、许可证和商标说明。

工具：Node.js 24.14.1；[cn-font-split](https://github.com/KonghaYao/cn-font-split) npm 7.4.3，Windows x86_64 原生库 7.6.8；Python 3.11 + fontTools 4.60.1。原生库生成的 CSS 注释标为 cn-font-split@7.4.0，这是库内版本文字，不是 npm 安装版本。无 npm 运行时依赖变更。

从仓库根目录，在 PowerShell 执行准备命令（仅首次生成或明确更新字体时使用）：

```powershell
New-Item -ItemType Directory -Force .local/frontend-redesign-01/fonts | Out-Null
npm install --prefix .local/frontend-redesign-01/font-tools --no-save --package-lock=false --ignore-scripts cn-font-split@7.4.3
node .local/frontend-redesign-01/font-tools/node_modules/cn-font-split/dist/cli.js i x86_64-pc-windows-msvc@7.6.8
python -m pip install --target .local/frontend-redesign-01/font-tools/python fonttools==4.60.1
$fontCommit = '7889f11bf31170b5d092a083b357c8c8130f89e0'
foreach ($fontStyle in @('Regular', 'SemiBold')) {
  Invoke-WebRequest "https://raw.githubusercontent.com/adobe-fonts/source-han-serif/$fontCommit/OTF/SimplifiedChinese/SourceHanSerifSC-$fontStyle.otf" -OutFile ".local/frontend-redesign-01/fonts/SourceHanSerifSC-$fontStyle.otf"
}
Invoke-WebRequest "https://raw.githubusercontent.com/adobe-fonts/source-han-serif/$fontCommit/LICENSE.txt" -OutFile .local/frontend-redesign-01/fonts/OFL.txt
```

原始文件 SHA-256 可用 `Get-FileHash .local/frontend-redesign-01/fonts/SourceHanSerifSC-*.otf -Algorithm SHA256` 核对：Regular 为 `78aa7a328fd974df2d688c8a9fd74a33d8334dfa84ab24d9d11efb2ffc464117`，SemiBold 为 `faf16caeaf207e1926e01af8d9f1a8e71b0e9d8f51bf3b5d9a78f9f30e7e3e31`。改名不删除字体的授权信息：

```powershell
@'
from pathlib import Path
import sys
sys.path.insert(0, str(Path('.local/frontend-redesign-01/font-tools/python').resolve()))
from fontTools.ttLib import TTFont
for style in ['Regular', 'SemiBold']:
    source = Path(f'.local/frontend-redesign-01/fonts/SourceHanSerifSC-{style}.otf')
    font = TTFont(source)
    names = {1:'Ruwen Serif', 3:f'RuwenSerif-{style}-2.003',
             4:f'Ruwen Serif {style}', 6:f'RuwenSerif-{style}',
             16:'Ruwen Serif', 21:'Ruwen Serif'}
    for record in font['name'].names:
        if record.nameID in names:
            record.string = names[record.nameID].encode(record.getEncoding())
    cff = font['CFF '].cff
    cff.fontNames = [f'RuwenSerif-{style}']
    cff.topDictIndex[0].FamilyName = 'Ruwen Serif'
    cff.topDictIndex[0].FullName = f'Ruwen Serif {style}'
    font.save(source.with_name(f'RuwenSerif-{style}.otf'))
'@ | python -X utf8 -
```

以下脚本写入忽略目录再运行，不加入项目构建。源字体与工具下载结束后，生成过程离线完成。重新生成时先核对输出目录中的旧产物，只清理对应 400/600 目录的旧文件，以免留下无引用分片。

```powershell
@'
import fs from 'node:fs';
import path from 'node:path';
import { fontSplit } from 'cn-font-split';
for (const [style, weight] of [['Regular', '400'], ['SemiBold', '600']]) {
  const outDir = path.resolve(`apps/web/public/fonts/ruwen-serif/${weight}`);
  await fontSplit({
    input: new Uint8Array(fs.readFileSync(`.local/frontend-redesign-01/fonts/RuwenSerif-${style}.otf`)),
    outDir, css: {fontFamily:'Ruwen Serif', fontWeight:weight,
      fontStyle:'normal', fontDisplay:'swap', compress:false},
    chunkSize:70*1024, renameOutputFont:'[hash:6].[ext]',
    testHtml:false, reporter:false, silent:true,
  });
  const cssPath = path.join(outDir, 'result.css');
  const css = fs.readFileSync(cssPath, 'utf8')
    .replace(/^CreateTime:.*;\r?\n/m, '')
    .replaceAll('src:local("Ruwen Serif"),', 'src:');
  fs.writeFileSync(cssPath, css);
  fs.rmSync(path.join(outDir, 'index.proto'), {force:true});
}
fs.copyFileSync('.local/frontend-redesign-01/fonts/OFL.txt',
  'apps/web/public/fonts/ruwen-serif/OFL.txt');
'@ | Set-Content -Encoding utf8 .local/frontend-redesign-01/font-tools/build.mjs
node .local/frontend-redesign-01/font-tools/build.mjs
pnpm exec biome check --write apps/web/public/fonts/ruwen-serif
```

入口 font.css 只导入 `./400/result.css` 与 `./600/result.css`。移除生成时间使文本稳定，去掉 local() 确保加载受检的同源产物。生成结果约 58 MB；不预加载全部分片。用生产浏览器检查两档 `document.fonts` 加载及 CSP，见 `apps/web/e2e/production.spec.ts`。
