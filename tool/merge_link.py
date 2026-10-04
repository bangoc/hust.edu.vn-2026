import sys
import os
import re

def main():
    if len(sys.argv) != 3:
        print("Cú pháp: python merge_links.py <thu_muc_input> <file_output>")
        # python3 tool/merge_link.py data/link_all.txt
        sys.exit(1)
        
    input_dir = sys.argv[1]
    out_file = sys.argv[2]
    
    if not os.path.isdir(input_dir):
        print(f"Lỗi: Thư mục '{input_dir}' không tồn tại.")
        sys.exit(1)
        
    unique_links = set()
    # Dùng set cho mỗi đội để lọc trùng lặp ngay trong nội bộ file của đội đó,
    # nhưng vẫn tính 1 link cho 2 đội nếu cả 2 đội cùng đóng góp.
    team_links = {}
    
    # Regex tìm link chứa hust.edu.vn
    url_pattern = re.compile(r'(?:https?://)?[a-zA-Z0-9.-]*hust\.edu\.vn[^\s,<>"\']*')
    
    # Lặp qua tất cả các file trong thư mục input
    for filename in os.listdir(input_dir):
        infile = os.path.join(input_dir, filename)
        if not os.path.isfile(infile):
            continue
            
        team_links[filename] = set()
        
        with open(infile, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
            
        urls = url_pattern.findall(content)
        for url in urls:
            url = url.rstrip('.,;')
            if not url.startswith('http'):
                url = 'http://' + url
                
            unique_links.add(url)
            team_links[filename].add(url)
                
    total_unique = len(unique_links)
    
    # Tạo thư mục chứa file đầu ra nếu chưa có
    out_dir = os.path.dirname(out_file)
    if out_dir and not os.path.exists(out_dir):
        os.makedirs(out_dir)
        
    # Ghi kết quả
    with open(out_file, 'w', encoding='utf-8') as f:
        for url in sorted(unique_links):
            f.write(url + '\n')
            
    # In thống kê
    print(f"\n--- KẾT QUẢ HỢP NHẤT ---")
    print(f"Đã tổng hợp được {total_unique} liên kết duy nhất.")
    print(f"Đã lưu kết quả vào: {out_file}")
    print("\nThống kê số lượng đóng góp (1 link do 2 nhóm tìm ra sẽ được tính điểm cho cả 2):")
    
    for filename, links in team_links.items():
        count = len(links)
        percent = (count / total_unique * 100) if total_unique > 0 else 0
        print(f" - {filename:<20} : {count:>5} links ({percent:5.2f}% so với tổng số)")

if __name__ == '__main__':
    main()

# -- KẾT QUẢ HỢP NHẤT ---
# Đã tổng hợp được 101462 liên kết duy nhất.
# Đã lưu kết quả vào: data/raw/link_all.txt
#
# Thống kê số lượng đóng góp (1 link do 2 nhóm tìm ra sẽ được tính điểm cho cả 2):
#  - N10.txt              :    48 links ( 0.05% so với tổng số)
#  - BAT.txt              : 79700 links (78.55% so với tổng số)
#  - N1-links             : 14995 links (14.78% so với tổng số)
#  - N5-links.txt         :  3990 links ( 3.93% so với tổng số)
#  - N06_Ctrl+F           :  9516 links ( 9.38% so với tổng số)
#  - N5-links-v2.txt      : 23067 links (22.73% so với tổng số)
#  - InfoSeeker.txt       :  3920 links ( 3.86% so với tổng số)