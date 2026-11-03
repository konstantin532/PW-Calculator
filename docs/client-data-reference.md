# Данные предметов из клиента Comeback

Проверены первые десять предметных таблиц клиентского `elements.data`:9886 записей,
включая2913 определений бонусов и6895 записей оружия/брони/украшений. Они нужны для
сверки существующего каталога. Этот этап не добавляет классы, предметы, NPC или умения.

## Источник и воспроизводимость

С разрешения пользователя извлечён только предметный payload из его клиента.
Входной файл не редактируется. В Git попадают собственный reader, описание структуры
как JSON и компактная таблица скоростей существующего каталога. Полный бинарный файл,
полные разобранные строки и сторонняя реализация редактора остаются вне Git.

| Факт | Значение |
|---|---|
| Имя payload | `elements.data` |
| Размер |69355251байт |
| SHA256 |`86c649d928c1707ea8100e5849fa4edad75cc372c2daba85e0bca0d6c6f0813a` |
| Header version/signature |30003/12288 |
| Timestamp в header |1742378400 |
| Последний разобранный байт |9090584 (не включая) |
| Подтверждённые существующие weaponID |3122/3122 |
| Совпадение дальности клиента с каталогом |3122/3122 |

Номер header30003 не выдаётся за номер релиза игры. Исходные bytes header сохраняются;
профиль проверяет их фактическую пару version/signature. Он не подменяет их на80.

Команда повторного построения из локального payload:

```powershell
.venv\Scripts\python.exe -m tools.client.elements `
  --elements .cache/client-data/elements.data `
  --output .cache/client-data/item-inputs.json `
  --catalog data/catalog_items.json `
  --speeds-output data/catalog_client_speeds.json
```

CLI разрешает обычный item export только под `.cache` репозитория, а таблицу скоростей —
только в `data/catalog_client_speeds.json`. Он отвергает совпадение любого входного и
выходного пути. В сохранённом provenance есть basename/hash; абсолютного пути пользователя нет.

## Проверенная структура

Первичная [v80-схема sELedit](https://github.com/Wrechid/sELedit-/blob/master/sELedit/bin/Debug/configs/PW_1.4.6_v80.cfg)
задаёт типы ранних таблиц. Этот payload имеет дополнительные4байта в каждой записи
weapon/armor/decoration. Порядок полей независимо описан авторским проектом CatBase:
[weapon](https://github.com/CatBase/pw-elements-data-declarations/blob/master/Structures/004-WEAPON_ESSENCE.txt),
[armor](https://github.com/CatBase/pw-elements-data-declarations/blob/master/Structures/007-ARMOR_ESSENCE.txt),
[decoration](https://github.com/CatBase/pw-elements-data-declarations/blob/master/Structures/010-DECORATION_ESSENCE.txt).
У оружия это `probability_addon_num5` перед `probability_unique`; у брони и украшений —
`probability_addon_num4` перед массивом addons. Наш JSON хранит факты формата; код
стороннего reader в проект не переносится.

| Таблица | Count | Байт/строка | Начало | Конец |
|---|---:|---:|---:|---:|
|EQUIPMENT_ADDON|2913|84|12|244704|
|WEAPON_MAJOR_TYPE|11|68|244708|245456|
|WEAPON_SUB_TYPE|32|356|245460|256852|
|WEAPON_ESSENCE|3387|1424|256856|5079944|
|ARMOR_MAJOR_TYPE|7|68|5079948|5080424|
|ARMOR_SUB_TYPE|17|72|5080428|5081652|
|ARMOR_ESSENCE|2581|1132|5081656|8003348|
|DECORATION_MAJOR_TYPE|3|68|8003352|8003556|
|DECORATION_SUB_TYPE|8|72|8003560|8004136|
|DECORATION_ESSENCE|927|1172|8004140|9090584|

Reader проверяет bounds каждого count/record, согласованность row size, уникальность
положительных ID, конечность float, диапазон probability0…1, корректность UTF-16 имён,
ссылки major/subtype/addon/refine. Все эти проверки прошли на полном объёме десяти таблиц.
Пустые имена сохранены и посчитаны отдельно:1240weapon,441armor,6decoration. Они не
объявляются доступными игровыми предметами.

Public Python API:

```python
from tools.client.elements import read_elements, bonus_inputs, build_speed_reference

parsed = read_elements(payload_path)
raw_item_facts = bonus_inputs(parsed)
speeds = build_speed_reference(parsed, existing_catalog)
```

`read_elements` возвращает `source`, `parsed_bytes`, `tables` с raw rows и `_offset`.
`bonus_inputs` сохраняет source, таблицы metadata и коллекции `addons`, `weapon_subtypes`,
`items`. У item есть исходные scalar/base/requirement поля, `table`, `offset`,
`addon_count_probabilities` и массивы `addons/rands/uniques` вида `{id,probability}`.
Нулевая вероятность не удаляет ненулевой addonID. Raw params addon не преобразуются в
произвольный тип автоматически: например, int может хранить bits float-коэффициента.

## Подтверждение обычной скорости атаки

`attack_speed` — float в **WEAPON_SUB_TYPE**, а не поле каждого WEAPON_ESSENCE.
[Авторский sELedit tooltip reader](https://github.com/Wrechid/sELedit-/blob/master/sELedit/COMMON/GetProps/WEAPON_ESSENCE.cs)
в строках46–55 берёт соответствующий subtype и выводит `1 / attack_speed` с двумя
десятичными знаками. Таким образом, это интервал; `1.11` и `1.25` не надо искать в rawfloat
как готовые APS (удары в секунду).

| ItemID | SubtypeID | Raw интервал | APS | Дальность |
|---|---:|---:|---:|---:|
|22|18|0.8999999761581421|1.11|3|
|78|76|1.0|1.00|4|
|12647|336|0.800000011920929|1.25|3|
|33533|336|0.800000011920929|1.25|3|

У всех2147 именованных weapon rows probability_normal=1, остальные speed probabilities=0.
Все3122 weaponID нынешнего каталога имеют положительный интервал и такой же однозначный
профиль normal. Генератор отказывается выбирать скорость при неоднозначных probabilities.

До применения client sidecar stored APS отличался от клиента у3100/3122 существующих
weaponID; среди2089 именованных отличался у2067. Это исходный снимок `catalog_items.json`,
а не утверждение об уже применённом API overlay. Примеры: ID12 хранил2 вместо1.11;
ID22 хранил4 вместо1.11. Все дальности совпали. Полный raw maximum range50 принадлежит
ID11214 `GM`; он не объявлен допустимой дальностью обычного игрока.

`catalog_client_speeds.json` сохраняет общий source hash/schema hash/команду/первичную
ссылку и строки `{item_id,attack_interval,aps,range,range_matches_catalog,normal_probability,
row_offset,subtype_id,subtype_offset}`. Пользовательское наблюдение о Метеоре33533 и прежний
defaults sidecar здесь не редактируются.

## Границы проверки

Остальные таблицы, серверные боевые формулы, skills и NPC этим reader не интерпретируются.
Присутствие сабель/кос и резервных записей в payload не расширяет пользовательский список
десяти разрешённых классов Comeback1.4.6. Полная проверка алгоритма генерации fixed/random
bonus rolls и форматирования эффектов находится в отдельном модуле properties.

`tests/test_client_elements.py` использует маленький бинарный fixture, собранный по
независимо заданным offsets. Проверяет повреждённые header/count/bounds/ссылки/float/имена,
нулевую probability fixed addon, ограниченный export, read-only CLI, обратную величину APS
и покрытие committed sidecar без установленной игры. Полный набор проверок проекта
запускается родительским этапом; здесь выполняются только целевые проверки reader.
