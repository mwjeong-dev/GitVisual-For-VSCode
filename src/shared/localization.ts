export type Translator = (english: string, korean?: string) => string;

type Locale = 'de' | 'es' | 'fr' | 'ja' | 'pt-br' | 'zh-cn' | 'zh-tw';

const translations: Record<Locale, Record<string, string>> = {
	ja: {
		file: 'ファイル', files: 'ファイル', 'changed file': '変更されたファイル', 'changed files': '変更されたファイル',
		'Refresh changes': '変更を更新', 'Expand all': 'すべて展開', 'Collapse all': 'すべて折りたたむ', Amend: '修正',
		'Commit message': 'コミットメッセージ', Commit: 'コミット', 'Commit and Push…': 'コミットしてプッシュ…',
		'All Selected Changes': '選択したすべての変更', 'Unversioned Files': 'バージョン管理外ファイル',
		'Move to changelist': 'チェンジリストへ移動', 'Delete Changelist': 'チェンジリストを削除', 'Changelist name': 'チェンジリスト名',
		'New branch from HEAD': 'HEAD から新しいブランチ', 'Fetch all remotes and prune deleted refs': 'すべてのリモートを取得して削除済み参照を整理',
		'Update selected branch': '選択したブランチを更新', 'Create patch from selection': '選択項目からパッチを作成',
		'Delete selected branch or tag': '選択したブランチまたはタグを削除', 'Search branches': 'ブランチを検索',
		'Search branches and tags': 'ブランチとタグを検索', 'Select a branch or tag first.': '先にブランチまたはタグを選択してください。',
		'Remote branches cannot be deleted here.': 'ここではリモートブランチを削除できません。', Checkout: 'チェックアウト',
		'Double-click to filter Git Graph': 'ダブルクリックして Git グラフを絞り込み', 'Push…': 'プッシュ…',
		'New Branch from Here…': 'ここから新しいブランチ…', 'Create Tag Here…': 'ここにタグを作成…',
		'Delete Tag…': 'タグを削除…', 'Delete Branch…': 'ブランチを削除…', Local: 'ローカル', Remote: 'リモート', Tags: 'タグ',
		'current branch': '現在のブランチ', 'detached or unavailable': 'デタッチ状態または利用不可', 'Loading…': '読み込み中…',
		'Search commits, authors, refs, or hashes': 'コミット、作成者、参照、ハッシュを検索', Branch: 'ブランチ',
		'Clear branch filter': 'ブランチフィルターを解除', Author: '作成者', Date: '日付',
		'Select a commit to see its details': '詳細を表示するコミットを選択してください', 'All branches': 'すべてのブランチ',
		'Filter by branch': 'ブランチで絞り込み', '(no subject)': '(件名なし)', 'No Git remote is configured.': 'Git リモートが設定されていません。',
		'Patch file created.': 'パッチファイルを作成しました。', 'Tags cannot be updated.': 'タグは更新できません。',
		'The selected branch has no upstream.': '選択したブランチに upstream がありません。',
		'The currently checked-out branch cannot be deleted.': '現在チェックアウト中のブランチは削除できません。',
		Delete: '削除', Revert: '元に戻す', Rebase: 'リベース', 'New Branch': '新しいブランチ', 'New Tag': '新しいタグ',
		'Edit Commit Message': 'コミットメッセージを編集', 'Select reset mode': 'リセットモードを選択',
	},
	'zh-cn': {
		file:'个文件',files:'个文件','changed file':'个已更改文件','changed files':'个已更改文件',
		'Refresh changes':'刷新更改','Expand all':'全部展开','Collapse all':'全部折叠',Amend:'修正','Commit message':'提交消息',Commit:'提交','Commit and Push…':'提交并推送…','All Selected Changes':'所有选定的更改','Unversioned Files':'未版本控制的文件','Move to changelist':'移动到变更列表','Delete Changelist':'删除变更列表','Changelist name':'变更列表名称','New branch from HEAD':'从 HEAD 新建分支','Fetch all remotes and prune deleted refs':'获取所有远程并清理已删除的引用','Update selected branch':'更新所选分支','Create patch from selection':'从所选项创建补丁','Delete selected branch or tag':'删除所选分支或标签','Search branches':'搜索分支','Search branches and tags':'搜索分支和标签','Select a branch or tag first.':'请先选择分支或标签。','Remote branches cannot be deleted here.':'无法在此删除远程分支。',Checkout:'签出','Double-click to filter Git Graph':'双击筛选 Git 图形','Push…':'推送…','New Branch from Here…':'从此处新建分支…','Create Tag Here…':'在此处创建标签…','Delete Tag…':'删除标签…','Delete Branch…':'删除分支…',Local:'本地',Remote:'远程',Tags:'标签','current branch':'当前分支','detached or unavailable':'分离或不可用','Loading…':'正在加载…','Search commits, authors, refs, or hashes':'搜索提交、作者、引用或哈希',Branch:'分支','Clear branch filter':'清除分支筛选',Author:'作者',Date:'日期','Select a commit to see its details':'选择提交以查看详情','All branches':'所有分支','Filter by branch':'按分支筛选','(no subject)':'（无主题）','No Git remote is configured.':'未配置 Git 远程。','Patch file created.':'补丁文件已创建。','Tags cannot be updated.':'无法更新标签。','The selected branch has no upstream.':'所选分支没有上游。','The currently checked-out branch cannot be deleted.':'无法删除当前签出的分支。',Delete:'删除',Revert:'还原',Rebase:'变基','New Branch':'新建分支','New Tag':'新建标签','Edit Commit Message':'编辑提交消息','Select reset mode':'选择重置模式',
	},
	'zh-tw': {
		file:'個檔案',files:'個檔案','changed file':'個已變更檔案','changed files':'個已變更檔案',
		'Refresh changes':'重新整理變更','Expand all':'全部展開','Collapse all':'全部摺疊',Amend:'修正','Commit message':'提交訊息',Commit:'提交','Commit and Push…':'提交並推送…','All Selected Changes':'所有選取的變更','Unversioned Files':'未納入版本控制的檔案','Move to changelist':'移至變更清單','Delete Changelist':'刪除變更清單','Changelist name':'變更清單名稱','New branch from HEAD':'從 HEAD 建立分支','Update selected branch':'更新選取的分支','Create patch from selection':'從選取項目建立修補檔','Delete selected branch or tag':'刪除選取的分支或標籤','Search branches':'搜尋分支','Search branches and tags':'搜尋分支與標籤','Select a branch or tag first.':'請先選取分支或標籤。',Checkout:'簽出','Push…':'推送…','New Branch from Here…':'從這裡建立分支…','Create Tag Here…':'在這裡建立標籤…','Delete Tag…':'刪除標籤…','Delete Branch…':'刪除分支…',Local:'本機',Remote:'遠端',Tags:'標籤','current branch':'目前分支','Loading…':'載入中…','Search commits, authors, refs, or hashes':'搜尋提交、作者、參照或雜湊',Branch:'分支','Clear branch filter':'清除分支篩選',Author:'作者',Date:'日期','Select a commit to see its details':'選取提交以檢視詳細資料','All branches':'所有分支','Filter by branch':'依分支篩選','(no subject)':'（無主旨）',Delete:'刪除',Revert:'還原',Rebase:'重定基底','New Branch':'新增分支','New Tag':'新增標籤','Edit Commit Message':'編輯提交訊息','Select reset mode':'選取重設模式',
	},
	es: {
		file:'archivo',files:'archivos','changed file':'archivo modificado','changed files':'archivos modificados',
		'Refresh changes':'Actualizar cambios','Expand all':'Expandir todo','Collapse all':'Contraer todo',Amend:'Modificar','Commit message':'Mensaje del commit',Commit:'Confirmar cambios','Commit and Push…':'Confirmar y enviar…','All Selected Changes':'Todos los cambios seleccionados','Unversioned Files':'Archivos sin versionar','Move to changelist':'Mover a la lista de cambios','Delete Changelist':'Eliminar lista de cambios','Changelist name':'Nombre de la lista de cambios','New branch from HEAD':'Nueva rama desde HEAD','Update selected branch':'Actualizar rama seleccionada','Create patch from selection':'Crear parche de la selección','Delete selected branch or tag':'Eliminar rama o etiqueta seleccionada','Search branches':'Buscar ramas','Search branches and tags':'Buscar ramas y etiquetas','Select a branch or tag first.':'Selecciona primero una rama o etiqueta.',Checkout:'Cambiar','Push…':'Enviar…','New Branch from Here…':'Nueva rama desde aquí…','Create Tag Here…':'Crear etiqueta aquí…','Delete Tag…':'Eliminar etiqueta…','Delete Branch…':'Eliminar rama…',Local:'Local',Remote:'Remoto',Tags:'Etiquetas','current branch':'rama actual','Loading…':'Cargando…','Search commits, authors, refs, or hashes':'Buscar commits, autores, referencias o hashes',Branch:'Rama','Clear branch filter':'Borrar filtro de rama',Author:'Autor',Date:'Fecha','Select a commit to see its details':'Selecciona un commit para ver sus detalles','All branches':'Todas las ramas','Filter by branch':'Filtrar por rama','(no subject)':'(sin asunto)',Delete:'Eliminar',Revert:'Revertir',Rebase:'Rebase','New Branch':'Nueva rama','New Tag':'Nueva etiqueta','Edit Commit Message':'Editar mensaje del commit','Select reset mode':'Seleccionar modo de restablecimiento',
	},
	de: {
		file:'Datei',files:'Dateien','changed file':'geänderte Datei','changed files':'geänderte Dateien',
		'Refresh changes':'Änderungen aktualisieren','Expand all':'Alle erweitern','Collapse all':'Alle reduzieren',Amend:'Ändern','Commit message':'Commit-Nachricht',Commit:'Commit','Commit and Push…':'Commit und Push…','All Selected Changes':'Alle ausgewählten Änderungen','Unversioned Files':'Nicht versionierte Dateien','Move to changelist':'In Änderungsliste verschieben','Delete Changelist':'Änderungsliste löschen','Changelist name':'Name der Änderungsliste','New branch from HEAD':'Neuer Branch von HEAD','Update selected branch':'Ausgewählten Branch aktualisieren','Create patch from selection':'Patch aus Auswahl erstellen','Delete selected branch or tag':'Ausgewählten Branch oder Tag löschen','Search branches':'Branches durchsuchen','Search branches and tags':'Branches und Tags durchsuchen','Select a branch or tag first.':'Wählen Sie zuerst einen Branch oder Tag aus.',Checkout:'Auschecken','Push…':'Push…','New Branch from Here…':'Neuer Branch von hier…','Create Tag Here…':'Tag hier erstellen…','Delete Tag…':'Tag löschen…','Delete Branch…':'Branch löschen…',Local:'Lokal',Remote:'Remote',Tags:'Tags','current branch':'aktueller Branch','Loading…':'Wird geladen…','Search commits, authors, refs, or hashes':'Commits, Autoren, Referenzen oder Hashes durchsuchen',Branch:'Branch','Clear branch filter':'Branchfilter löschen',Author:'Autor',Date:'Datum','Select a commit to see its details':'Wählen Sie einen Commit aus, um Details anzuzeigen','All branches':'Alle Branches','Filter by branch':'Nach Branch filtern','(no subject)':'(kein Betreff)',Delete:'Löschen',Revert:'Zurücksetzen',Rebase:'Rebase','New Branch':'Neuer Branch','New Tag':'Neuer Tag','Edit Commit Message':'Commit-Nachricht bearbeiten','Select reset mode':'Reset-Modus auswählen',
	},
	fr: {
		file:'fichier',files:'fichiers','changed file':'fichier modifié','changed files':'fichiers modifiés',
		'Refresh changes':'Actualiser les modifications','Expand all':'Tout développer','Collapse all':'Tout réduire',Amend:'Modifier','Commit message':'Message de commit',Commit:'Commit','Commit and Push…':'Commit et Push…','All Selected Changes':'Toutes les modifications sélectionnées','Unversioned Files':'Fichiers non versionnés','Move to changelist':'Déplacer vers la liste de modifications','Delete Changelist':'Supprimer la liste de modifications','Changelist name':'Nom de la liste de modifications','New branch from HEAD':'Nouvelle branche depuis HEAD','Update selected branch':'Mettre à jour la branche sélectionnée','Create patch from selection':'Créer un patch depuis la sélection','Delete selected branch or tag':'Supprimer la branche ou l’étiquette sélectionnée','Search branches':'Rechercher des branches','Search branches and tags':'Rechercher des branches et des étiquettes','Select a branch or tag first.':'Sélectionnez d’abord une branche ou une étiquette.',Checkout:'Extraire','Push…':'Push…','New Branch from Here…':'Nouvelle branche depuis ici…','Create Tag Here…':'Créer une étiquette ici…','Delete Tag…':'Supprimer l’étiquette…','Delete Branch…':'Supprimer la branche…',Local:'Local',Remote:'Distant',Tags:'Étiquettes','current branch':'branche actuelle','Loading…':'Chargement…','Search commits, authors, refs, or hashes':'Rechercher des commits, auteurs, références ou hachages',Branch:'Branche','Clear branch filter':'Effacer le filtre de branche',Author:'Auteur',Date:'Date','Select a commit to see its details':'Sélectionnez un commit pour afficher ses détails','All branches':'Toutes les branches','Filter by branch':'Filtrer par branche','(no subject)':'(sans objet)',Delete:'Supprimer',Revert:'Rétablir',Rebase:'Rebase','New Branch':'Nouvelle branche','New Tag':'Nouvelle étiquette','Edit Commit Message':'Modifier le message du commit','Select reset mode':'Sélectionner le mode de réinitialisation',
	},
	'pt-br': {
		file:'arquivo',files:'arquivos','changed file':'arquivo alterado','changed files':'arquivos alterados',
		'Refresh changes':'Atualizar alterações','Expand all':'Expandir tudo','Collapse all':'Recolher tudo',Amend:'Emendar','Commit message':'Mensagem do commit',Commit:'Commit','Commit and Push…':'Commit e Push…','All Selected Changes':'Todas as alterações selecionadas','Unversioned Files':'Arquivos não versionados','Move to changelist':'Mover para a lista de alterações','Delete Changelist':'Excluir lista de alterações','Changelist name':'Nome da lista de alterações','New branch from HEAD':'Nova branch a partir de HEAD','Update selected branch':'Atualizar branch selecionada','Create patch from selection':'Criar patch da seleção','Delete selected branch or tag':'Excluir branch ou tag selecionada','Search branches':'Pesquisar branches','Search branches and tags':'Pesquisar branches e tags','Select a branch or tag first.':'Selecione primeiro uma branch ou tag.',Checkout:'Checkout','Push…':'Push…','New Branch from Here…':'Nova branch a partir daqui…','Create Tag Here…':'Criar tag aqui…','Delete Tag…':'Excluir tag…','Delete Branch…':'Excluir branch…',Local:'Local',Remote:'Remoto',Tags:'Tags','current branch':'branch atual','Loading…':'Carregando…','Search commits, authors, refs, or hashes':'Pesquisar commits, autores, referências ou hashes',Branch:'Branch','Clear branch filter':'Limpar filtro de branch',Author:'Autor',Date:'Data','Select a commit to see its details':'Selecione um commit para ver os detalhes','All branches':'Todas as branches','Filter by branch':'Filtrar por branch','(no subject)':'(sem assunto)',Delete:'Excluir',Revert:'Reverter',Rebase:'Rebase','New Branch':'Nova branch','New Tag':'Nova tag','Edit Commit Message':'Editar mensagem do commit','Select reset mode':'Selecionar modo de reset',
	},
};

function resolveLocale(language: string): Locale | undefined {
	const normalized = language.toLowerCase().replace('_', '-');
	if (normalized.startsWith('zh-tw') || normalized.startsWith('zh-hk')) return 'zh-tw';
	if (normalized.startsWith('zh')) return 'zh-cn';
	if (normalized.startsWith('pt')) return 'pt-br';
	for (const locale of ['de', 'es', 'fr', 'ja'] as const) if (normalized.startsWith(locale)) return locale;
	return undefined;
}

export function createTranslator(language: string): Translator {
	const normalized = language.toLowerCase();
	if (normalized.startsWith('ko')) return (english, korean) => korean ?? english;
	const locale = resolveLocale(language);
	return (english) => locale ? translations[locale][english] ?? english : english;
}
