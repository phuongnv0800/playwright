# Dau TOEIC Reading Crawl

Hướng dẫn này dành riêng cho việc crawl dữ liệu từ [https://dautoeic.com/reading](https://dautoeic.com/reading).

## Phạm vi

- Crawl toàn bộ danh sách bài đọc đang hiển thị trên `/reading`.
- Mặc định chỉ lấy các bản ghi `is_hidden = false`.
- Xuất ra:
  - `passages.json`: dữ liệu đầy đủ của từng passage
  - `summary.json`: thống kê nhanh để kiểm tra kết quả
  - `passages.csv`: danh sách tóm tắt để mở bằng spreadsheet

## Cách tiếp cận

Script không scrape DOM của trang danh sách. Thay vào đó, nó đọc từ Supabase public API mà frontend của site đang gọi. Cách này ổn định hơn cho nhu cầu export dữ liệu vì:

- Không phụ thuộc selector của SPA
- Lấy được trực tiếp `content_html`, `questions_json`, `vocabulary_json`
- Không cần giữ session hoặc click qua từng bài

Đây vẫn là dữ liệu public mà chính frontend đang dùng. Nếu site thay đổi backend hoặc key public, có thể override bằng biến môi trường bên dưới.

## Chạy script

```bash
npm run crawl:dautoeic:reading
```

Output mặc định được ghi vào:

```text
output/dautoeic-reading
```

## Tuỳ chọn

Đổi thư mục output:

```bash
npm run crawl:dautoeic:reading -- --output-dir output/custom-dautoeic
```

Lấy cả các bản ghi hidden nếu backend cho phép:

```bash
npm run crawl:dautoeic:reading -- --include-hidden
```

Đổi page size khi crawl:

```bash
npm run crawl:dautoeic:reading -- --page-size 25
```

## Biến môi trường hỗ trợ

- `DAUTOEIC_SUPABASE_URL`
- `DAUTOEIC_SUPABASE_ANON_KEY`

Nếu không truyền, script dùng giá trị public hiện tại đang được frontend site publish.

## Cấu trúc dữ liệu export

Mỗi passage trong `passages.json` có các trường chính:

- `id`
- `url`
- `title`
- `level`
- `accessLevel`
- `questionCount`
- `vocabularyCount`
- `sentenceCount`
- `sentences`
- `vocabulary`
- `questions`
- `contentHtml`

## Kết quả crawl hiện tại

Tại thời điểm triển khai script này, dữ liệu trên `/reading` có:

- `100` passages
- `50` passages level 1
- `50` passages level 2
- `70` passages free
- `30` passages pro
- `410` questions
- `619` vocabulary entries
- `791` sentence blocks

## File liên quan

- Script crawl: `/Users/phuongnv/Downloads/project/playwright/src/scripts/crawl-dautoeic-reading.ts`
- Core module: `/Users/phuongnv/Downloads/project/playwright/src/scripts/dautoeic-reading.ts`
- Output mặc định: `/Users/phuongnv/Downloads/project/playwright/output/dautoeic-reading`
