import zipfile, os, json

# 脚本位于 scripts/ 子目录，manifest 等在上一级目录。
base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(base)
ver = json.load(open('manifest.json'))['version']
out = os.path.join('dist', 'cloudfile-local-session-receiver-%s.zip' % ver)
os.makedirs('dist', exist_ok=True)
files = [
    'manifest.json', 'background.js', 'popup.js', 'popup.html', 'popup.css',
    # 系统通知与工具条/角标都读这组图标，必须一起打包。
    'icons/icon16.png', 'icons/icon32.png', 'icons/icon48.png', 'icons/icon128.png',
]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for f in files:
        z.write(f, f)
print(out)
print('size:', os.path.getsize(out))
