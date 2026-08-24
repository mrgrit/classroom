// AI 학습자료 보기 페이지 (서버가 markdown을 안전하게 HTML로 렌더링해서 내려줌)
(async function () {
  const id = location.pathname.split('/').pop();
  const loggedIn = await Auth.init();
  if (!loggedIn) return;
  document.getElementById('report-view').classList.remove('hidden');

  const timeFmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const fmtTime = (utc) => {
    const d = new Date(String(utc).replace(' ', 'T') + 'Z');
    return isNaN(d) ? utc : timeFmt.format(d);
  };

  let r;
  try {
    r = await api(`/api/reports/${id}`);
  } catch (err) {
    document.getElementById('report-title').textContent = err.message;
    return;
  }
  document.title = `${r.title} - Classroom Padlet`;
  document.getElementById('report-title').textContent = r.title;
  document.getElementById('report-meta').textContent =
    [r.student_name, [r.board_title, r.column_title].filter(Boolean).join(' / '), r.model, fmtTime(r.created_at)].filter(Boolean).join(' · ');
  document.getElementById('report-body').innerHTML = r.html;
  document.getElementById('report-pdf').href = `/api/reports/${id}/pdf`;
  document.getElementById('report-delete').addEventListener('click', async () => {
    if (!confirm('이 학습자료를 삭제할까요?')) return;
    try {
      await api(`/api/reports/${id}`, { method: 'DELETE' });
      location.href = '/me';
    } catch (err) {
      alert(err.message);
    }
  });
})();
