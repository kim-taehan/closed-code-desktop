#!/usr/bin/env python3
"""PDF 파일에서 텍스트를 추출하는 스크립트"""

import sys

def extract_pdf_text(pdf_path):
    """PDF 파일에서 텍스트를 추출합니다."""
    try:
        # pypdf 시도
        try:
            from pypdf import PdfReader
            reader = PdfReader(pdf_path)
            text = ""
            for page in reader.pages:
                text += page.extract_text() + "\n"
            return text
        except ImportError:
            pass
        
        # PyPDF2 시도
        try:
            from PyPDF2 import PdfReader
            reader = PdfReader(pdf_path)
            text = ""
            for page in reader.pages:
                text += page.extract_text() + "\n"
            return text
        except ImportError:
            pass
            
        return "PDF 라이브러리를 찾을 수 없습니다. (pypdf 또는 PyPDF2 필요)"
        
    except Exception as e:
        return f"PDF 읽기 오류: {str(e)}"

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("사용법: python3 extract_pdf.py <pdf_파일_경로>")
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    text = extract_pdf_text(pdf_path)
    print(text)
