const fs = require('fs');
const data = JSON.parse(fs.readFileSync('backend/course-data/prereqs.json', 'utf8'));
const regex = /([A-Z]{2,8}\s*\d{3}[A-Z]*).*?(\d{2})%|(\d{2})%.*?([A-Z]{2,8}\s*\d{3}[A-Z]*)/gi;
let count = 0;
for (const course of Object.values(data)) {
  const text = course.prereq_text;
  if (!text) continue;
  let m;
  const matches = [...text.matchAll(regex)];
  if (matches.length > 0 && text.includes('%')) {
    console.log(text);
    console.log(matches.map(x => x[0]));
    count++;
    if (count > 5) break;
  }
}
