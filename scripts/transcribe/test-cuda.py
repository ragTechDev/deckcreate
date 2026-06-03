#!/usr/bin/env python3
"""Test if CUDA is available for faster-whisper"""
import sys
import os

print("Python version:", sys.version)
print("Python executable:", sys.executable)
print()

# Check if CUDA libraries are in PATH
cuda_path = os.environ.get('CUDA_PATH')
print(f"CUDA_PATH environment variable: {cuda_path}")
print()

# Try importing torch to check CUDA
try:
    import torch
    print(f"PyTorch version: {torch.__version__}")
    print(f"CUDA available in PyTorch: {torch.cuda.is_available()}")
    if torch.cuda.is_available():
        print(f"CUDA version: {torch.version.cuda}")
        print(f"GPU devices: {torch.cuda.device_count()}")
        print(f"GPU 0 name: {torch.cuda.get_device_name(0)}")
except ImportError:
    print("PyTorch not installed (needed for GPU support)")
    print("Install with: pip install torch --index-url https://download.pytorch.org/whl/cu121")
except Exception as e:
    print(f"Error checking PyTorch CUDA: {e}")

print()

# Try importing faster_whisper
try:
    from faster_whisper import WhisperModel
    print("faster-whisper is installed")
    
    # Try loading a small model on CPU first
    print("Testing CPU mode...")
    model = WhisperModel("tiny.en", device="cpu")
    print("✓ CPU mode works!")
    
except Exception as e:
    print(f"Error with faster-whisper: {e}")

print()
print("=" * 60)
print("DIAGNOSIS:")
print("=" * 60)

# Provide diagnosis
if 'torch' not in sys.modules:
    print("❌ PyTorch is not installed")
    print("   Solution: pip install torch --index-url https://download.pytorch.org/whl/cu121")
elif not torch.cuda.is_available():
    print("❌ CUDA is not available to PyTorch")
    print("   Possible causes:")
    print("   1. CUDA Toolkit not installed or not in PATH")
    print("   2. PyTorch CPU-only version installed")
    print("   Solution: Reinstall PyTorch with CUDA support:")
    print("   pip uninstall torch")
    print("   pip install torch --index-url https://download.pytorch.org/whl/cu121")
else:
    print("✓ CUDA is available and should work!")
