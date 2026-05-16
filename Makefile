# Henter UUID fra metadata.json
UUID = $(shell grep -Po '(?<="uuid": ")[^"]*' metadata.json)
ifeq ($(UUID),)
  $(error Kunne ikke finne UUID i metadata.json)
endif

INSTALL_PATH = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: all build install clean enable disable zip test pot translations update-po

all: test build

pot:
	@echo "Ekstraherer oversettbare strenger til po/$(UUID).pot..."
	@mkdir -p po
	@xgettext --from-code=UTF-8 --language=JavaScript --keyword=_ \
		--package-name="Agent Interaction" \
		--output=po/$(UUID).pot \
		extension.js prefs.js dialog.js utils.js

update-po: pot
	@for po in po/*.po; do \
		if [ -f "$$po" ]; then \
			echo "Oppdaterer $$po..."; \
			msgmerge --update $$po po/$(UUID).pot; \
		fi \
	done

translations:
	@if [ -d po ]; then \
		echo "Kompilerer oversettelser..."; \
		for po in po/*.po; do \
			if [ -f "$$po" ]; then \
				lang=$$(basename $$po .po); \
				mkdir -p locale/$$lang/LC_MESSAGES; \
				msgfmt $$po -o locale/$$lang/LC_MESSAGES/$(UUID).mo; \
			fi \
		done; \
	fi

build: translations
	@echo "Kompilerer schemaer lokalt..."
	@glib-compile-schemas schemas/

install: build
	@echo "Installerer til $(INSTALL_PATH)..."
	@mkdir -p $(INSTALL_PATH)/icons
	@mkdir -p $(INSTALL_PATH)/schemas
	@cp metadata.json $(INSTALL_PATH)/
	@cp extension.js $(INSTALL_PATH)/
	@cp dialog.js $(INSTALL_PATH)/
	@cp utils.js $(INSTALL_PATH)/
	@cp prefs.js $(INSTALL_PATH)/
	@cp stylesheet.css $(INSTALL_PATH)/
	@cp LICENSE $(INSTALL_PATH)/ 2>/dev/null || true
	@cp icons/*.svg $(INSTALL_PATH)/icons/ 2>/dev/null || true
	@cp schemas/*.xml $(INSTALL_PATH)/schemas/
	@cp -r locale $(INSTALL_PATH)/ 2>/dev/null || true
	@glib-compile-schemas $(INSTALL_PATH)/schemas/
	@echo "Installasjon fullført i $(INSTALL_PATH)"
	@echo "------------------------------------------------------------"
	@echo "1. Restart GNOME Shell (Logg ut og inn på Wayland)."
	@echo "2. Aktiver utvidelsen: gnome-extensions enable $(UUID)"

clean:
	@echo "Fjerner lokal installasjon og kompilerte filer..."
	rm -rf $(INSTALL_PATH)
	rm -f schemas/gschemas.compiled
	rm -rf locale

enable:
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)

zip: build
	@echo "Lager pakke for distribusjon..."
	@rm -f $(UUID).shell-extension.zip
	@mkdir -p _dist
	@cp metadata.json extension.js dialog.js utils.js prefs.js stylesheet.css LICENSE _dist/ 2>/dev/null || true
	@cp -r icons schemas locale _dist/ 2>/dev/null || true
	@cd _dist && zip -qr ../$(UUID).shell-extension.zip .
	@rm -rf _dist
	@echo "Pakke laget: $(UUID).shell-extension.zip"

test:
	@echo "Kjører enhetstester..."
	@gjs -m tests/unit_tests.js

release:
	@echo "Starter release-prosess (bumpe versjon og lage tag)..."
	@npm run release