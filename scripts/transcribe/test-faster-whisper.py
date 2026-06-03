#!/usr/bin/env python3
"""Test faster-whisper CUDA loading - mimics actual transcription code path"""

import sys
import os

print("\n" + "="*60)
print("Testing faster-whisper CUDA model loading")
print("="*60 + "\n")

# Check imports
print("[1/4] Checking imports...")
try:
    import torch
    print(f"  [OK] PyTorch version: {torch.__version__}")
except ImportError as e:
    print(f"  [ERROR] PyTorch not installed: {e}")
    sys.exit(1)

try:
    from faster_whisper import WhisperModel
    print(f"  [OK] faster-whisper imported")
except ImportError as e:
    print(f"  [ERROR] faster-whisper not installed: {e}")
    print("\nInstall with: pip install faster-whisper")
    sys.exit(1)

# Check CUDA availability
print("\n[2/4] Checking CUDA...")
if torch.cuda.is_available():
    print(f"  [OK] CUDA available")
    print(f"  [OK] PyTorch CUDA version: {torch.version.cuda}")
    print(f"  [OK] GPU: {torch.cuda.get_device_name(0)}")
else:
    print(f"  [WARNING] CUDA not available to PyTorch")
    print("\n  This means PyTorch was installed without CUDA support.")
    print("  Reinstall with: pip install torch --index-url https://download.pytorch.org/whl/cu121")
    sys.exit(1)

# Check CUDA Toolkit version match
print("\n[3/4] Checking CUDA Toolkit version...")
cuda_path = os.environ.get('CUDA_PATH', 'Not set')
print(f"  CUDA_PATH: {cuda_path}")
pytorch_cuda = torch.version.cuda
print(f"  PyTorch expects CUDA: {pytorch_cuda}")

if cuda_path != 'Not set':
    # Extract version from path if possible
    import re
    match = re.search(r'v(\d+\.\d+)', cuda_path)
    if match:
        toolkit_version = match.group(1)
        print(f"  CUDA Toolkit version: {toolkit_version}")
        
        # Check major version match
        toolkit_major = toolkit_version.split('.')[0]
        pytorch_major = pytorch_cuda.split('.')[0] if pytorch_cuda else '?'
        
        if toolkit_major != pytorch_major:
            print(f"\n  [WARNING] Version mismatch!")
            print(f"  PyTorch built for CUDA {pytorch_cuda}, but you have CUDA {toolkit_version}")
            print(f"  This might cause crashes.")
            print(f"\n  Solution: Install PyTorch for CUDA {toolkit_major}:")
            print(f"  pip uninstall torch")
            print(f"  pip install torch --index-url https://download.pytorch.org/whl/cu{toolkit_major}21")

# Try loading a model with CUDA
print("\n[4/4] Attempting to load faster-whisper model with CUDA...")
print("  This is the actual test - if this crashes, CUDA won't work.\n")

try:
    print("  Loading model: large-v3 (production model)")
    print("  Device: cuda")
    print("  Compute type: float16")
    print("  NOTE: First run downloads ~3GB model, may take 5-10 minutes")
    print("  This may take 10-20 seconds (or longer on first run)...\n")
    
    model = WhisperModel(
        "large-v3",
        device="cuda",
        compute_type="float16"
    )
    
    print("\n  [SUCCESS] Model loaded successfully!")
    print("  CUDA is working properly for faster-whisper.")
    print("\n" + "="*60)
    print("DIAGNOSIS: CUDA should work for transcription")
    print("="*60 + "\n")
    
except Exception as e:
    print(f"\n  [ERROR] Failed to load model: {e}")
    print(f"\n  Error type: {type(e).__name__}")
    
    error_str = str(e).lower()
    
    if "cuda" in error_str or "gpu" in error_str:
        print("\n" + "="*60)
        print("DIAGNOSIS: CUDA library loading failed")
        print("="*60)
        print("\nPossible causes:")
        print("1. PyTorch CUDA version doesn't match installed CUDA Toolkit")
        print("2. Missing CUDA runtime libraries (cuBLAS, cuDNN, etc.)")
        print("3. Corrupted PyTorch installation")
        print("\nSolution:")
        print("1. Check versions above for mismatch")
        print("2. Reinstall PyTorch with matching CUDA version")
        print("3. Or try CPU mode: npm run transcribe:gpu -- --model large-v3 --device cpu")
    else:
        print("\n" + "="*60)
        print("DIAGNOSIS: Unknown error")
        print("="*60)
        print(f"\nFull error: {e}")
    
    sys.exit(1)
