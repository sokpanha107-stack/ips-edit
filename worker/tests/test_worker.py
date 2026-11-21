"""Offline tests (no GPU, no models): python3 -m unittest discover -s worker/tests -v
They check the parts that must not silently break: Seed-VC flag filtering and the music checkpoint/resume logic."""
import importlib, os, sys, tempfile, unittest, types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for sub in ('music', 'voice'): sys.path.insert(0, str(ROOT / sub))
os.environ['ATOM_STATE'] = tempfile.mkdtemp(prefix='atom_state_')
for m in ('numpy', 'soundfile'):                       # only needed by real mastering, stubbed here when the sandbox lacks them
    try: importlib.import_module(m)
    except ImportError: sys.modules[m] = types.ModuleType(m)
pipeline = importlib.import_module('pipeline')


class SeedVcFlags(unittest.TestCase):
    def test_unknown_flags_are_dropped_with_their_value(self):
        sv = tempfile.mkdtemp()
        Path(sv, 'inference.py').write_text("import argparse\np=argparse.ArgumentParser()\nfor f in ('--source','--target','--output','--fp16'): p.add_argument(f)\np.parse_args()\n")
        pipeline._SV_FLAGS.clear()
        cmd = pipeline.seedvc_cmd(sv, ['--source', 'a.wav', '--target', 'b.wav', '--output', 'o', '--semi-tone-shift', '3', '--fp16', 'True'])
        self.assertNotIn('--semi-tone-shift', cmd); self.assertNotIn('3', cmd)
        self.assertEqual(cmd[2:], ['--source', 'a.wav', '--target', 'b.wav', '--output', 'o', '--fp16', 'True'])

    def test_all_flags_kept_when_help_is_unreadable(self):
        pipeline._SV_FLAGS.clear()
        args = ['--source', 'a', '--f0-condition', 'True']
        self.assertEqual(pipeline.seedvc_cmd('/nonexistent-dir', args), ['python', 'inference.py', *args])


class MusicCheckpoint(unittest.TestCase):
    def setUp(self):
        self.calls = []; self.fail_at = None
        pipeline.CKPT_ROOT = Path(tempfile.mkdtemp(prefix='ckpt_'))
        def w(path, tag):
            self.calls.append(tag)
            if self.fail_at == tag: raise RuntimeError('boom ' + tag)
            Path(path).write_bytes(b'x' * 8192)
        pipeline.compose = lambda p, out, seed: (w(out, 'compose'), out)[1]
        def sep(raw, work): w(work / 'instrumental.wav', 'separate'); (work / 'temp_guide_vocal.wav').write_bytes(b'x' * 8192); return work / 'instrumental.wav', work / 'temp_guide_vocal.wav'
        pipeline.separate = sep
        def clo(guide, voice, index, pitch, work): w(work / 'signature_vocal.wav', 'clone'); Path(guide).unlink(missing_ok=True); return work / 'signature_vocal.wav'
        pipeline.clone = clo
        def mas(inst, vocal, p, out, work): w(out, 'master'); return 213.0
        pipeline.master = mas
        pipeline.free_gpu = lambda: None
        self.voice = Path(tempfile.mkdtemp()) / 'v.wav'; self.voice.write_bytes(b'v' * 100)
        self.p = {'lyrics': 'la', 'style_prompt': 'pop', 'seed': 1}

    def run_render(self):
        out = Path(tempfile.mkdtemp()) / 'o.mp3'
        return pipeline.render(self.p, self.voice, None, out, lambda *a: None)

    def test_full_run_cleans_checkpoint(self):
        self.run_render(); self.assertEqual(self.calls, ['compose', 'separate', 'clone', 'master'])
        self.assertEqual(list(pipeline.CKPT_ROOT.glob('music_*')), [])

    def test_retry_skips_finished_stages(self):
        self.fail_at = 'master'
        with self.assertRaises(RuntimeError): self.run_render()
        self.calls.clear(); self.fail_at = None; self.run_render()
        self.assertEqual(self.calls, ['master'])                         # compose, separate and clone were NOT repeated

    def test_failure_in_clone_keeps_raw_and_stems(self):
        self.fail_at = 'clone'
        with self.assertRaises(RuntimeError): self.run_render()
        self.calls.clear(); self.fail_at = None; self.run_render()
        self.assertEqual(self.calls, ['clone', 'master'])

    def test_different_song_does_not_reuse_checkpoint(self):
        self.fail_at = 'master'
        with self.assertRaises(RuntimeError): self.run_render()
        self.calls.clear(); self.fail_at = None; self.p = {**self.p, 'lyrics': 'different'}; self.run_render()
        self.assertEqual(self.calls, ['compose', 'separate', 'clone', 'master'])


if __name__ == '__main__': unittest.main()
