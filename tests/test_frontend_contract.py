import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "index.html").read_text(encoding="utf-8")
MODULE = re.search(r'<script\s+type="module">(.*?)</script>', HTML, re.S).group(1)
STATIC_MARKUP = HTML.split('<script src="./vendor/pdf-lib.min.js">', 1)[0]


class FrontendContractTests(unittest.TestCase):
    def test_four_writing_modes_remain_exact(self):
        modes = re.findall(r'data-pen-mode="([^"]+)"', STATIC_MARKUP)
        self.assertEqual(modes, ["ink", "pencil", "highlighter", "fountain"])
        self.assertNotRegex(STATIC_MARKUP, r'data-tool="highlighter"')

    def test_full_page_and_text_only_ai_paths_exist(self):
        self.assertIn("captureCurrentPageForAI", MODULE)
        self.assertIn("drawImage(el.pdfCanvas", MODULE)
        self.assertIn("drawImage(el.inkCanvas", MODULE)
        self.assertIn("type:'image_url'", MODULE)
        self.assertIn("pdfDoc?'Açık sayfanın tamamı otomatik eklenecek.'", MODULE)
        self.assertIn("'Metinle soru sorabilirsin.'", MODULE)
        self.assertIn("MAX_AI_HISTORY_MESSAGES=36", MODULE)
        self.assertIn("AbortController", MODULE)
        self.assertIn("95000", MODULE)

    def test_no_settings_dialog_or_provider_details_in_ai_markup(self):
        for removed in ('id="apiModal"', 'id="apiSettingsBtn"', 'id="providerSelect"', 'id="apiKeyInput"'):
            self.assertNotIn(removed, STATIC_MARKUP)
        self.assertNotRegex(STATIC_MARKUP, r"(?i)\bNVIDIA\b|\bNIM\b|Gemini|z-ai/glm")
        self.assertNotIn("Önce soruyu kırp", STATIC_MARKUP)

    def test_infinityfree_php_api_paths_are_used(self):
        self.assertIn("fetch('/api/nvidia/status.php'", MODULE)
        self.assertIn("requestWithRetry('/api/nvidia/chat.php'", MODULE)
        self.assertNotIn("NVIDIA_API_KEY", MODULE)

    def test_ai_setup_uses_a_private_env_file_and_server_side_connection_test(self):
        self.assertIn('id="aiSetupModal"', STATIC_MARKUP)
        self.assertIn('id="aiTestConnectionBtn"', STATIC_MARKUP)
        self.assertIn('id="newAiChatBtn"', STATIC_MARKUP)
        self.assertIn("fetch('/api/nvidia/test.php'", MODULE)
        self.assertIn("function copyAiEnvExample()", MODULE)
        self.assertNotIn('id="apiKeyInput"', STATIC_MARKUP)
        self.assertIn("API_KEY=", STATIC_MARKUP)
        self.assertNotIn("AI_API_KEY", STATIC_MARKUP)
        self.assertNotRegex(STATIC_MARKUP, r"(?i)\bNVIDIA\b|\bNIM\b|z-ai/glm")
        self.assertNotRegex(HTML, r"nvapi-[A-Za-z0-9]")
        self.assertNotIn("nvidiaModel", MODULE)
        self.assertNotIn("model:nvidiaModel", MODULE)

    def test_connection_test_errors_are_sanitized_before_display(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("Node.js is not installed")
        start = MODULE.index("function safeConnectionError")
        end = MODULE.index("async function testNvidiaConnection", start)
        helper = MODULE[start:end]
        exercise = """
const key=safeConnectionError('NVIDIA API anahtarı reddedildi.',401);
const busy=safeConnectionError('NVIDIA modeli şu anda yoğun.',503);
const storage=safeConnectionError('AI kullanım sınırı denetlenemedi.',503);
const origin=safeConnectionError('İstek aynı web sitesinden gönderilmelidir.',403);
for(const message of [key,busy,storage,origin])if(/NVIDIA|glm|model/i.test(message))throw new Error('provider details leaked into UI');
if(!key.includes('anahtar'))throw new Error('key error is not actionable');
if(!storage.includes('izinlerini'))throw new Error('storage error is not actionable');
if(!origin.includes('site adresi'))throw new Error('origin error is not actionable');
"""
        result = subprocess.run([node, "-e", helper + exercise], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_progress_uses_current_pdf_instead_of_mock_weekly_data(self):
        self.assertNotIn("4 / 6 gün", STATIC_MARKUP)
        self.assertNotIn("+0 bugün", STATIC_MARKUP)
        self.assertNotIn("Son çalışma şimdi", STATIC_MARKUP)
        self.assertNotIn("Apple Pencil hazır", STATIC_MARKUP)
        self.assertIn("docCrumb", MODULE)
        self.assertIn("length:pdfDoc.numPages", MODULE)
        self.assertIn("week-progress", MODULE)
        self.assertNotIn('data-nav="Son açılanlar"', STATIC_MARKUP)
        self.assertNotIn('data-nav="Kaydedilenler"', STATIC_MARKUP)

    def test_task_actions_are_native_accessible_buttons(self):
        self.assertIn("open.className='task-open'", MODULE)
        self.assertIn("check.type='button'", MODULE)
        self.assertIn("aria-pressed", MODULE)

    def test_save_status_is_truthful_and_flushes_on_lifecycle(self):
        self.assertIn("saveRevision", MODULE)
        self.assertIn("Kalıcı kayıt kullanılamıyor", MODULE)
        self.assertIn("visibilitychange", MODULE)
        self.assertIn("pagehide", MODULE)

    def test_every_literal_id_selector_exists_in_static_markup(self):
        ids = re.findall(r'\bid="([^"]+)"', STATIC_MARKUP)
        self.assertEqual(len(ids), len(set(ids)), "duplicate static id")
        refs = set(re.findall(r"\$\(['\"]#([\w-]+)['\"]\)", MODULE))
        self.assertFalse(refs - set(ids), f"missing DOM ids: {sorted(refs - set(ids))}")

    def test_ai_history_is_bounded_and_preserves_image_context(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("Node.js is not installed")
        start = MODULE.index("const MAX_AI_HISTORY_MESSAGES=36;")
        end = MODULE.index("function escapeMarkdownHtml", start)
        helper = MODULE[start:end]
        exercise = """
const image={role:'user',text:'page question',image:{mimeType:'image/jpeg',data:'sample'}};
aiHistory.push(image,{role:'assistant',text:'first answer'});trimAiHistory();
for(let i=0;i<60;i++){aiHistory.push({role:'user',text:'q'+i});trimAiHistory();aiHistory.push({role:'assistant',text:'a'+i});trimAiHistory();}
const recent=aiHistory.slice(2);if(aiHistory.length>38)throw new Error('history exceeded proxy window');
if(aiHistory[0]!==image||aiHistory[1].role!=='assistant')throw new Error('image context was dropped');
if(recent.length&&recent[0].role!=='user')throw new Error('window starts with an assistant turn');
"""
        result = subprocess.run([node, "-e", "let aiHistory=[];\n" + helper + exercise], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_download_has_a_manual_fallback_and_preserves_blob_long_enough(self):
        self.assertIn('id="toastAction"', STATIC_MARKUP)
        self.assertIn('id="toastOpen"', STATIC_MARKUP)
        self.assertIn('id="toastShare"', STATIC_MARKUP)
        self.assertIn("pointer-events:auto", HTML)
        self.assertIn("navigator.share", MODULE)
        self.assertIn("window.showSaveFilePicker", MODULE)
        self.assertIn("createWritable", MODULE)
        self.assertIn("openLink.target=window.top===window.self?'_blank':'_self'", MODULE)
        self.assertIn("link.download=filename", MODULE)
        self.assertIn("120000", MODULE)
        self.assertIn("PDFLib.PDFDocument.load(sourceBytes.slice())", MODULE)

    def test_pdf_lib_can_annotate_and_roundtrip_the_demo_pdf(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("Node.js is not installed")
        pdf_lib = str(ROOT / "vendor" / "pdf-lib.min.js")
        demo_pdf = str(ROOT / "assets" / "demo.pdf")
        script = f"""
const fs=require('fs');const {{PDFDocument,rgb}}=require({pdf_lib!r});
(async()=>{{const original=fs.readFileSync({demo_pdf!r});const doc=await PDFDocument.load(original);const page=doc.getPages()[0];
page.drawLine({{start:{{x:30,y:30}},end:{{x:90,y:90}},thickness:2,color:rgb(.2,.3,.8),opacity:.7}});
page.drawCircle({{x:90,y:90,size:2,color:rgb(.2,.3,.8),opacity:.7}});
const output=await doc.save();if(output.length<=original.length)throw new Error('annotation did not expand the PDF');
const reopened=await PDFDocument.load(output);if(reopened.getPageCount()!==doc.getPageCount())throw new Error('page count changed');
}})().catch(error=>{{console.error(error);process.exit(1);}});
"""
        result = subprocess.run([node, "-e", script], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_javascript_parses_when_node_is_available(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("Node.js is not installed")
        with tempfile.NamedTemporaryFile("w", suffix=".mjs", encoding="utf-8") as script:
            script.write(MODULE)
            script.flush()
            result = subprocess.run([node, "--check", script.name], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
