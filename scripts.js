(function() {
  var req = indexedDB.open('notes', 1);
  var id = location.hash.slice(1);
  var auto, db, timeout;

  var rules = {
    a: _('[') + '$1' + _('](<a class="output-token" href="$3">$2$3$4$5</a>)'),
    heading: function(raw, hash, text, trail) {
      var level = 'h' + hash.length;

      return '<' + level + '>' + _(hash) + text + (trail ? _(trail) : '') + '</' + level + '>';
    },
    lheading: function(raw, text, under) {
      var level = under[0] === '=' ? 'h1' : 'h2';

      return '<' + level + '>' + text + '</' + level + '>\n' + _(under);
    },
    hr: _('$1') + '<hr>',
    sl: '  <span class="output-token smart-item">$1</span> $2',
    ul: function(raw) {
      return '<ul>' + raw.replace(/^( {2,}[+*-] )(.*)/mg, '<li>' + _('$1') + '$2</li>') + '</ul>';
    },
    ol: function(raw) {
      var counts = [];

      return '<ol>' + raw.replace(/^( {2,})\d+\. (.*)/mg, function(line, spaces, text) {
        var level = Math.floor(spaces.length / 2) - 1;

        counts.length = level + 1;

        if (!counts[level]) {
          counts[level] = 1;
        }

        var shown = counts[level] > 99 ? '..' : String(counts[level]++);

        return '<li>' + _(' ' + spaces.slice(shown.length) + shown + '. ') + text + '<li>';
      }) + '</ol>';
    },
    strong: _('$1$1') + '<strong>$2</strong>' + _('$1$1'),
    em: _('$1') + '<em>$2</em>' + _('$1'),
    blockquote: function(raw) {
      return '<blockquote>' + raw.replace(/^( *&gt;)/mg, _('$1')) + '</blockquote>';
    },
    br: '<br>'
  };

  var vm = new Vue({
    el: '.app',
    data: {
      out: '',
      search: '',
      translate: 'translate(0,0)',
      dropdown: false,
      currentNote: {},
      notes: []
    },
    computed: {
      filteredNotes: function() {
        var search = this.search.toLowerCase();

        return this.notes.filter(function (note) {
          return note.body.toLowerCase().indexOf(search) >= 0;
        });
      }
    },
    mounted: function() {
      if (db) {
        fetchNotes();
      }
    },
    methods: {
      newNote: function(body) {
        var randomId = Math.random().toString(16).slice(2, 10);

        location.hash = '#' + randomId;
        vm.currentNote = {
          id: randomId,
          title: '',
          body: body || '',
          meta: new Date().toLocaleString(),
          created: Date.now()
        };

        vm.notes = [vm.currentNote].concat(vm.notes);

        Vue.nextTick(function() {
          this.$el.querySelector('.input').dispatchEvent(new Event('input'));
        }, this);
      },
      openNote: function(id) {
        location.hash = '#' + id;

        var note = this.notes.find(function(note) {
          return note.id === id;
        });

        if (!note) {
          this.newNote();
          return;
        }

        this.currentNote = note;

        Vue.nextTick(function() {
          this.$el.querySelector('.input').dispatchEvent(new Event('input'));
        }, this);
      },
      click: function(event) {
        if (event.target.className.indexOf('dropdown-item') >= 0) {
          var input = event.currentTarget.querySelector('.input');
          var selS = input.selectionStart;
          var selE = input.selectionEnd;
          var symbol = input.value.slice(selS - 2, selS + 2);

          input.value = input.value.slice(0, selS - 2) + symbol.replace(/\S+/, event.target.innerText) + input.value.slice(selS + 2);
          input.selectionStart = selS;
          input.selectionEnd = selE;
          input.dispatchEvent(new Event('input'));
          this.dropdown = false;

          return;
        }

        if (!event.metaKey) {
          this.dropdown = false;

          return;
        }

        if (event.target.className.indexOf('smart-item') >= 0) {
          this.dropdown = [(event.layerX - 17) + 'px', (event.layerY + 16) + 'px'];
          event.preventDefault();

          return;
        }

        this.dropdown = false;

        event.target.style.visibility = 'hidden';

        document.elementFromPoint(event.pageX, event.pageY)
          .dispatchEvent(new MouseEvent('click', event));

        event.target.style.visibility = 'visible';
      },
      parse: function (event) {
        var self = this;

        this.out = render(event.target.value);

        this.currentNote.body = event.target.value;
        this.currentNote.title = this.out.split('<br>', 1)[0]
          .replace(/<span .*?>.*?<\/.*?>/g, '')
          .replace(/<.*?>/g, '').trim();

        clearTimeout(timeout);

        timeout = setTimeout(function() {
          timeout = null;
          saveNote(self.currentNote);
        }, 200);
      },
      scroll: function(event) {
        this.translate = 'translate(-' + event.target.scrollLeft + 'px,-' + event.target.scrollTop + 'px)';
      },
      keydown: function (event) {
        var text = '\n' + event.target.value + '\n';
        var selS = event.target.selectionStart;
        var selE = event.target.selectionEnd;

        if (event.key === 'Backspace' && selS === selE && auto) {
          event.target.value = text.slice(1, selS - auto.length + 1) + (selS === text.length - 2 ? '' : '\n') + text.slice(selS + auto.length, -1);
          event.target.selectionStart = selS - auto.length;
          event.target.selectionEnd = selS - auto.length;
          event.target.dispatchEvent(new Event('input'));
          event.preventDefault();

          return;
        }

        var prev = text.lastIndexOf('\n', selS);

        if (event.key === 'Tab') {
          if (event.shiftKey && text.slice(prev + 1, prev + 3) !== '  ') {
            event.preventDefault();

            return;
          }

          event.target.value = text.slice(1, prev + 1) + (event.shiftKey ? text.slice(prev + 3, -1) : '  ' + text.slice(prev + 1, -1));
          event.target.selectionStart = selS + (event.shiftKey ? -2 : 2);
          event.target.selectionEnd = selE + (event.shiftKey ? -2 : 2);
          event.target.dispatchEvent(new Event('input'));
          event.preventDefault();

          return;
        }

        if (event.key !== 'Enter') {
          auto = null;

          return;
        }

        var start = text.slice(prev + 1).match(/^(:? *> *| {2,}[+*-] | {2,}\d+\. |  .- )/);

        if (!start || prev === selS) {
          return;
        }

        auto = start[0];

        event.target.value = text.slice(1, selS + 1) + '\n' + auto + text.slice(selS + 1, -1);
        event.target.selectionStart = selS + 1 + auto.length;
        event.target.selectionEnd = selS + 1 + auto.length;
        event.target.dispatchEvent(new Event('input'));

        event.preventDefault();
      }
    }
  });

  req.onsuccess = function() {
    db = req.result;

    if (vm.$el) {
      fetchNotes();
    }
  };

  req.onupgradeneeded = function(event) {
    db = event.target.result;
    db.createObjectStore('note', { keyPath: 'id' }).createIndex('created', 'created');
  }

  function fetchNotes() {
    var transaction = db.transaction(['note']);
    var store = transaction.objectStore('note');
    var req = store.index('created').openCursor(null, 'prev');

    req.onsuccess = function(event) {
      var cursor = event.target.result;

      if (!cursor) {
        if (location.hash) {
          vm.openNote(location.hash.slice(1));

          return;
        }

        vm.newNote(vm.notes.length ? '' : tutorial());

        return;
      }

      vm.notes.push(cursor.value);
      cursor.continue();
    }
  }

  function saveNote(note) {
    if (!note.body.trim()) {
      return;
    }

    var transaction = db.transaction(['note'], 'readwrite');
    var store = transaction.objectStore('note');

    store.put(note);
  }

  function render(raw) {
    var noParse = [];
    return raw
      .replace(/\r\n|\r/g, '\n')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/`([^`\n]+)`/g, function(code, text) {
        noParse[noParse.length] = _('`') + '<code>' + text + '</code>' + _('`');

        return '%%' + (noParse.length - 1) + '%%';
      })
      .replace(/^```(.*)\n([\S\s]+?)\n```$/mg, function(code, lang, text) {
        noParse[noParse.length] = '<pre>' + _('```' + lang) + '\n' + text + '\n' + _('```') + '</pre>';

        return '%%' + (noParse.length - 1) + '%%';
      })
      .replace(/\[([\s\S]+?)\]\(( *)(http[^\s"]+)( +)?("[^"]*?" *)?\)/g, rules.a)
      .replace(/^(#{1,6})( +.+?)( *#+ *)?$/mg, rules.heading)
      .replace(/(.+)\n(-+|=+)$/mg, rules.lheading)
      .replace(/^(([-*_]) *\2 *\2 *(?:\2 *)*)$/mg, rules.hr)
      .replace(/  (.-|&lt;&gt;|\|&gt;|&lt;\||::|--) (.*)/mg, rules.sl)
      .replace(/(?:(?:^|\n) {2,}[+*-] .*)+/g, rules.ul)
      .replace(/(?:(?:^|\n) {2,}\d+\. .*)+/g, rules.ol)
      .replace(/(\*|_)\1(?!\1|\s?<\/)([\S\s]+?)\1\1/g, rules.strong)
      .replace(/(\*|_)(?!\1|\s?<\/)([\S\s]+?)\1/g, rules.em)
      .replace(/^ *&gt;.*(?:\n *&gt;.+)*/mg, rules.blockquote)
      .replace(/%%(\d+)%%/g, function(token, index) {
        return noParse[index];
      })
      .replace(/\n/g, rules.br);
  }

  function _(token) {
    return '<span class="output-token">' + token + '</span>';
  }

  function tutorial() {
    return '# Welcome! 😙\n\nWhat is this? A little scratchpad thingy. Everything is synced to your browser, nothing gets sent to anyone. Here’s a quick tour to show you some stuff.\n\n***\n\n## Bullet Journal\n\n*Tip: cmd+click on bullets to update them*\n\n  .- Task\n  <> Done\n  |> Migrated\n  <| Scheduled\n  :: Event\n  -- Note\n\n***\n\n## Markdown (only a subset, really)\n\nSupported:\n  * Unordered lists\n  * Ordered lists (with auto-numbering)\n  * Links (no reference-link yet) -- Use cmd+click to open them\n  * Quotes\n  * Code blocks (no syntax highlighting yet)\n  * Inline code\n  * Headers (hashes & underlines)\n  * Horizontal rules\n  * Emphasis\n  * Strong emphasis\n\n***\n\n## History\n\n### 0.1.0 (Jul 29, 2017)\n\n  * First version\n  * Simple Markdown support\n  * Auto-saving\n  * Note search\n  * Smart lists (bullet journal items)\n\nMade with [Vue.js](https://vuejs.org), [Octicons](https://octicons.github.com/) and [Fira Code](https://github.com/tonsky/FiraCode).\n\nPull requests are welcome to [the GitHub repository](http://github.com/izeau/notes)!';
  }
})();
