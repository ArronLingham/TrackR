const state = window.APP_STATE;
let dragCourse = null;

// 2. Storage
function savePlannedToStorage() {
  localStorage.setItem('trackr_planned_v2', JSON.stringify({
    courses: state.plannedCoursesByTerm,
    labels: state.manualLabels || {}
  }));
}

function loadPlannedFromStorage() {
  const saved = localStorage.getItem('trackr_planned_v2');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed.courses === 'object') {
        state.plannedCoursesByTerm = parsed.courses || {};
        state.manualLabels = parsed.labels || {};
      } else {
        // legacy format support
        state.plannedCoursesByTerm = parsed;
        state.manualLabels = {};
      }
      reEvaluateProgress();
    } catch (e) {
      console.error("Failed to load planned courses", e);
    }
  }
}

// Helper: Format section labels
function formatLabel(key) {
  const labels = {
    required_courses: "Core Courses",
    elective_requirement: "Elective Requirements",
    additional_requirement: "Additional Requirements",
    communication_requirement: "Communication Requirement",
    breadth_requirement: "Breadth Requirement",
    depth_requirement: "Depth Requirement",
  };
  return labels[key] || key.replace(/_/g, " ");
}

// 1. Render Metrics
function renderMetrics() {
  const ac = state.academics;
  document.getElementById('metric-credits').textContent = ac.units.earned.toFixed(1) + ' / ' + ac.units.required.toFixed(1);
  document.getElementById('metric-math-credits').textContent = ac.units.math.earned.toFixed(1) + ' / ' + ac.units.math.required.toFixed(1);
  document.getElementById('metric-cum-avg').textContent = ac.averages.cumulative ? ac.averages.cumulative.toFixed(1) + '%' : '--';
  document.getElementById('metric-major-avg').textContent = ac.averages.math ? ac.averages.math.toFixed(1) + '%' : '--';
}

// 2. Render Requirements
function renderRequirements() {
  const list = document.getElementById('requirements-list');
  list.innerHTML = '';
  
  for (const [key, value] of Object.entries(state.progress)) {
    if (key === 'program') continue;
    
    // value could be an array of blocks or a single block (for breadth/depth)
    const blocks = Array.isArray(value) ? value : [value];
    
    blocks.forEach((block, index) => {
      const section = document.createElement('div');
      section.className = 'req-section';
      
      const title = block.description || formatLabel(key) + (blocks.length > 1 ? ` ${index + 1}` : '');
      const stateStr = block.state || 'unmet';
      
      const header = document.createElement('div');
      header.className = 'req-header';
      header.innerHTML = `
        <span>${title}</span>
        <span class="req-status ${stateStr}">${stateStr.replace('_', ' ')}</span>
      `;
      header.onclick = () => section.classList.toggle('open');
      
      const body = document.createElement('div');
      body.className = 'req-body';
      
      // Show taken/planned courses
      const taken = block.projected_taken || block.courses_taken || [];
      if (taken.length > 0) {
        body.innerHTML += `<div style="font-size: 0.8rem; font-weight:600; margin-bottom: 0.5rem">Satisfied by:</div>`;
        taken.forEach(c => {
           const code = typeof c === 'string' ? c : c.code;
           const title = state.courseTitles[code] || (typeof c === 'object' ? c.title : '');
           body.innerHTML += `<div class="course-chip completed">
              <div class="chip-top"><span>${code}</span></div>
              ${title ? `<div class="chip-title">${title}</div>` : ''}
           </div>`;
        });
      }
      
      // Show remaining courses to take (draggable)
      const remaining = block.courses_remaining || [];
      if (remaining.length > 0 && stateStr !== 'met' && stateStr !== 'planned') {
        const need = block.progress && block.progress.count ? block.progress.count.need : null;
        let text = "Options (Drag to plan):";
        if (block.type === 'all_required') {
          text = `Complete all of the following:`;
        } else if (need) {
          text = need > 1 ? `Choose ${need} of the following to fulfill the requirement:` : `Choose 1 of the following:`;
        }
        body.innerHTML += `<div style="font-size: 0.8rem; font-weight:600; margin: 1rem 0 0.5rem">${text}</div>`;
        
        let filteredRemaining = remaining;
        if (block.progress && block.progress.rules) {
           const unmetRules = block.progress.rules.filter(r => !r.met);
           if (unmetRules.length > 0) {
              body.innerHTML += `<div style="font-size: 0.8rem; color: #d97706; margin-bottom: 0.5rem;">
                Must also satisfy:
                <ul style="margin: 2px 0; padding-left: 1.5rem">
                  ${unmetRules.map(r => `<li>${r.message}</li>`).join('')}
                </ul>
              </div>`;
              
              const levelRules = unmetRules.filter(r => r.message.includes('-level'));
              if (levelRules.length > 0) {
                 filteredRemaining = remaining.filter(c => {
                    const code = typeof c === 'string' ? c : c.code;
                    const levelMatch = code.match(/\d{3}/);
                    if (!levelMatch) return true;
                    const courseLevel = parseInt(levelMatch[0]);
                    
                    return levelRules.some(r => {
                       const reqMatch = r.message.match(/(\d00)-level/);
                       if (!reqMatch) return true;
                       return courseLevel >= parseInt(reqMatch[1]);
                    });
                 });
              }
           }
        }
        
        const bin = document.createElement('div');
        bin.className = 'course-bin-list';
        
        const limit = 12;
        const showList = filteredRemaining.slice(0, limit);
        const hiddenList = filteredRemaining.slice(limit);
        
        const renderChip = (c) => {
          const code = typeof c === 'string' ? c : c.code;
          const title = state.courseTitles[code] || (typeof c === 'object' ? c.title : '');
          const chip = document.createElement('div');
          chip.className = 'bin-item';
          chip.textContent = title ? `${code} - ${title}` : code;
          chip.draggable = true;
          chip.ondragstart = (e) => {
            dragCourse = code;
            e.dataTransfer.setData('text/plain', code);
          };
          return chip;
        };

        showList.forEach(c => bin.appendChild(renderChip(c)));
        
        if (hiddenList.length > 0) {
          const moreBtn = document.createElement('button');
          moreBtn.className = 'btn';
          moreBtn.style.padding = '0.25rem 0.5rem';
          moreBtn.style.fontSize = '0.75rem';
          moreBtn.textContent = `... and ${hiddenList.length} more`;
          moreBtn.onclick = () => {
             moreBtn.remove();
             hiddenList.forEach(c => bin.appendChild(renderChip(c)));
          };
          bin.appendChild(moreBtn);
        }
        
        body.appendChild(bin);
      }
      
      if (!taken.length && !remaining.length) {
         body.innerHTML += `<div style="font-size: 0.875rem; color: var(--text-muted)">See calendar for specific rules.</div>`;
      }
      
      section.appendChild(header);
      section.appendChild(body);
      list.appendChild(section);
    });
  }
}

// 3. Render Calendar
function renderCalendar() {
  const grid = document.getElementById('calendar-grid');
  grid.innerHTML = '';
  
  // Track all courses taken chronologically for prereq checking
  const takenChronological = new Set();
  
  const studyLevels = ['1A', '1B', '2A', '2B', '3A', '3B', '4A', '4B', '5A', '5B'];
  let studyTermCount = 0;
  let workTermCount = 0;

  const getTermLabel = (isStudy, isWork) => {
    if (isStudy) {
      const level = studyLevels[studyTermCount] || `Study ${studyTermCount + 1}`;
      studyTermCount++;
      return level;
    } else if (isWork) {
      workTermCount++;
      return `WT${workTermCount}`;
    } else {
      return 'Off';
    }
  };

  const evaluatePrereqs = (code) => {
    const prereq = state.coursePrereqs && state.coursePrereqs[code];
    if (!prereq || !prereq.text) return { ok: true };
    
    // Split by commas and semicolons to approximate AND conditions
    const clauses = prereq.text.split(/[,;]/);
    let missingClause = null;
    
    for (const clause of clauses) {
      // Find all course codes in this clause
      const matches = [...clause.matchAll(/[A-Z]{2,8}\s*\d{3}[A-Z]*/g)].map(m => m[0].replace(/\s+/g, '').toUpperCase());
      if (matches.length > 0) {
        // We expect at least one of these codes to be taken
        const clauseSatisfied = matches.some(c => takenChronological.has(c));
        if (!clauseSatisfied) {
          missingClause = prereq.text;
          break;
        }
      }
    }
    
    // Evaluate Grade prerequisites if possible
    // Extract Grade requirements using regex
    // Looks for patterns like "STAT 206 with at least 60%" or "60% in MATH 137"
    const regex = /(?:([A-Z]{2,8}\s*\d{3}[A-Z]*)(?:(?!\b[A-Z]{2,8}\s*\d{3}[A-Z]*\b).){0,30}?(\d{2})%)|(?:(\d{2})%(?:(?!\b[A-Z]{2,8}\s*\d{3}[A-Z]*\b).){0,30}?([A-Z]{2,8}\s*\d{3}[A-Z]*))/gi;
    const matches = [...prereq.text.matchAll(regex)];
    
    for (const match of matches) {
       let codeRaw = match[1] || match[4];
       const gradeReq = parseInt(match[2] || match[3]);
       codeRaw = codeRaw.replace(/\s+/g, '').toUpperCase();
       
       // check if transcript has this grade
       if (transcriptGrades[codeRaw] !== undefined) {
          if (transcriptGrades[codeRaw] < gradeReq) {
             return { ok: false, text: `Requires ${gradeReq}% in ${codeRaw} (You have ${transcriptGrades[codeRaw]}%)` };
          }
       }
    }
    
    return { ok: missingClause === null, text: missingClause };
  };
  
  // Collect grades from past terms for grade prereq checking
  const transcriptGrades = {};
  
  // Past Terms
  state.terms.forEach(term => {
    const card = document.createElement('div');
    card.className = 'term-card';
    
    const count = term.entries.filter(e => !e.code.includes('WKRPT') && !e.code.includes('COOP')).length;
    const label = getTermLabel(count >= 3, count > 0 && count < 3);
    card.innerHTML = `<div class="term-header"><span>${term.name} - ${label}</span></div>`;
    
    const body = document.createElement('div');
    body.className = 'term-body';
    term.entries.forEach(e => {
       const statusClass = e.grade.earnsCredit ? 'completed' : (e.grade.inProgress ? 'in-progress' : '');
       const title = state.courseTitles[e.code] || '';
       
       if (e.grade.earnsCredit || e.grade.inProgress) {
         takenChronological.add(e.code.replace(/\s+/g, '').toUpperCase());
         if (e.grade.percent) {
           transcriptGrades[e.code.replace(/\s+/g, '').toUpperCase()] = e.grade.percent;
         }
       }
       
       body.innerHTML += `<div class="course-chip ${statusClass}">
          <div class="chip-top"><span>${e.code}</span><span>${e.grade.raw || 'IP'}</span></div>
          ${title ? `<div class="chip-title">${title}</div>` : ''}
       </div>`;
    });
    card.appendChild(body);
    grid.appendChild(card);
  });
  
  // Planned Terms
  Object.keys(state.plannedCoursesByTerm).forEach(termId => {
    const card = document.createElement('div');
    card.className = 'term-card';
    const courses = state.plannedCoursesByTerm[termId];
    
    const count = courses.filter(c => !c.includes('WKRPT') && !c.includes('COOP')).length;
    
    const manualType = state.manualLabels && state.manualLabels[termId];
    let isStudy = false, isWork = false, isOff = false;
    
    if (manualType === 'Study') isStudy = true;
    else if (manualType === 'Work') isWork = true;
    else if (manualType === 'Off') isOff = true;
    else {
      if (count >= 3) isStudy = true;
      else if (count > 0) isWork = true;
      else isOff = true;
    }
    
    const label = getTermLabel(isStudy, isWork);
    
    const header = document.createElement('div');
    header.className = 'term-header';
    header.title = "Change term type";
    header.innerHTML = `
      <span>${termId} - </span>
      <select class="term-type-select" style="font-size: 0.875rem; background: transparent; border: none; font-weight: bold; cursor: pointer; color: inherit; padding: 0;">
        <option value="Study" style="color: initial" ${isStudy ? 'selected' : ''}>${isStudy ? label : 'Study'}</option>
        <option value="Work" style="color: initial" ${isWork ? 'selected' : ''}>${isWork ? label : 'Work'}</option>
        <option value="Off" style="color: initial" ${isOff ? 'selected' : ''}>Off</option>
        <option value="Auto" style="color: initial" ${!manualType ? 'selected' : ''}>Auto</option>
      </select>
    `;
    const select = header.querySelector('select');
    select.onchange = (e) => {
      const val = e.target.value;
      if (!state.manualLabels) state.manualLabels = {};
      if (val === 'Auto') {
         delete state.manualLabels[termId];
      } else {
         state.manualLabels[termId] = val;
      }
      savePlannedToStorage();
      reEvaluateProgress();
    };
    
    card.appendChild(header);
    
    const body = document.createElement('div');
    body.className = 'term-body dropzone';
    
    // Render planned courses inside
    courses.forEach(c => {
       const title = state.courseTitles[c] || '';
       
       const prereqCheck = evaluatePrereqs(c.replace(/\s+/g, '').toUpperCase());
       const warningHtml = prereqCheck.ok ? '' : `<span title="Missing Prerequisites:\n${prereqCheck.text}" style="cursor:help; margin-left:4px">⚠️</span>`;
       
       body.innerHTML += `<div class="course-chip planned">
          <div class="chip-top"><span>${c}${warningHtml}</span><span style="font-size:0.75rem; cursor:pointer" onclick="removePlanned('${termId}', '${c}')">❌</span></div>
          ${title ? `<div class="chip-title">${title}</div>` : ''}
       </div>`;
       
       takenChronological.add(c.replace(/\s+/g, '').toUpperCase());
    });
    
    body.ondragover = (e) => { e.preventDefault(); body.classList.add('drag-over'); };
    body.ondragleave = (e) => { body.classList.remove('drag-over'); };
    body.ondrop = (e) => {
      e.preventDefault();
      body.classList.remove('drag-over');
      const courseCode = e.dataTransfer.getData('text/plain');
      if (courseCode) {
        addPlanned(termId, courseCode);
      }
    };
    
    card.appendChild(body);
    grid.appendChild(card);
  });
}

let termCounter = 1;
document.getElementById('btn-add-term').onclick = () => {
  const name = `Future Term ${termCounter++}`;
  state.plannedCoursesByTerm[name] = [];
  renderCalendar();
};

window.removePlanned = function(termId, courseCode) {
  state.plannedCoursesByTerm[termId] = state.plannedCoursesByTerm[termId].filter(c => c !== courseCode);
  savePlannedToStorage();
  reEvaluateProgress();
};

function addPlanned(termId, courseCode) {
  if (!state.plannedCoursesByTerm[termId].includes(courseCode)) {
    state.plannedCoursesByTerm[termId].push(courseCode);
    savePlannedToStorage();
    reEvaluateProgress();
  }
}

// 4. API Request to Re-evaluate
window.reEvaluateProgress = async function() {
  const completed = [];
  const inProgress = [];
  
  state.terms.forEach(term => {
    term.entries.forEach(e => {
      if (e.grade.earnsCredit) completed.push(e.code);
      if (e.grade.inProgress) inProgress.push(e.code);
    });
  });
  
  // Gather all planned
  const planned = Object.values(state.plannedCoursesByTerm).flat();
  
  try {
    const res = await fetch('/api/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        major: state.major,
        completed,
        inProgress,
        planned
      })
    });
    const data = await res.json();
    if (data.progress) {
      state.progress = data.progress;
      state.summary = data.summary;
      state.outstanding = data.outstanding;
      if (data.courseTitles) {
        state.courseTitles = { ...state.courseTitles, ...data.courseTitles };
      }
      if (data.coursePrereqs) {
        state.coursePrereqs = { ...state.coursePrereqs, ...data.coursePrereqs };
      }
      renderRequirements();
      renderCalendar();
    }
  } catch(e) {
    console.error("Failed to update progress", e);
  }
}

// Modal handling
document.getElementById('btn-change-major').onclick = () => {
  document.getElementById('modal-settings').classList.add('open');
};
document.getElementById('btn-close-modal').onclick = () => {
  document.getElementById('modal-settings').classList.remove('open');
};

document.getElementById('btn-config-sequence').onclick = () => {
  document.getElementById('modal-sequence').classList.add('open');
};
document.getElementById('btn-close-sequence').onclick = () => {
  document.getElementById('modal-sequence').classList.remove('open');
};

// Sequence generation logic
document.getElementById('btn-apply-sequence').onclick = () => {
  const seqType = document.getElementById('sequence-select').value;
  if (seqType === 'none') {
    document.getElementById('modal-sequence').classList.remove('open');
    return;
  }
  
  const lastTerm = state.terms.length > 0 ? state.terms[state.terms.length - 1].name : "Spring 2024";
  const parts = lastTerm.split(" ");
  let season = parts[0];
  let year = parseInt(parts[1]) || 2024;
  
  const nextTerm = () => {
    if (season === 'Fall') season = 'Winter', year++;
    else if (season === 'Winter') season = 'Spring';
    else if (season === 'Spring') season = 'Fall';
    return `${season} ${year}`;
  };
  
  // Map sequence type to a template of terms (S = Study, W = Work, O = Off)
  const templates = {
    seq1: ['S','S','O','S','W','S','W','S','W','S','W','S','W','S'], // Standard Math Sequence 1
    seq2: ['S','S','W','S','W','S','W','S','W','S','W','S','O','S'],
    seq3: ['S','S','W','S','S','W','S','W','S','W','S','W','O','S'],
    seq4: ['S','S','S','W','S','W','S','W','S','W','S','W','O','S'],
    reg:  ['S','S','O','S','S','O','S','S','O','S','S']
  };
  
  const template = templates[seqType] || templates.seq1;
  
  state.plannedCoursesByTerm = {};
  state.manualLabels = {};
  
  // We assume the student's past terms consumed the first N items of the template.
  // Actually, we'll just generate the remaining 14 - state.terms.length terms starting from nextTerm.
  const remainingCount = Math.max(0, template.length - state.terms.length);
  const remainingTemplate = template.slice(-remainingCount);
  
  let studyCount = state.terms.filter(t => t.entries.filter(e => !e.code.includes('WKRPT') && !e.code.includes('COOP')).length >= 3).length;
  let workCount = state.terms.length - studyCount;
  
  for (let i = 0; i < remainingTemplate.length; i++) {
    const name = nextTerm();
    const type = remainingTemplate[i];
    let label = '';
    
    if (type === 'S') {
      const levels = ['1A', '1B', '2A', '2B', '3A', '3B', '4A', '4B'];
      label = levels[studyCount] || `Study ${studyCount+1}`;
      studyCount++;
    } else if (type === 'W') {
      workCount++;
      label = `WT${workCount}`;
    } else {
      label = `Off`;
    }
    
    state.plannedCoursesByTerm[name] = [];
    state.manualLabels[name] = label;
  }
  
  savePlannedToStorage();
  reEvaluateProgress();
  document.getElementById('modal-sequence').classList.remove('open');
};

// Init
loadPlannedFromStorage();
renderMetrics();
renderRequirements();
renderCalendar();
