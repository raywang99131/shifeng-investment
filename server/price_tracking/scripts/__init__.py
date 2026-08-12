"""Project data-collection scripts.

Modules in this package fetch external price/volume data and update the
shared `price_summarized_optimized.xlsx` workbook at the project root.

Importing any module by its short name requires that this directory be on
``sys.path`` (Python does this automatically when scripts are run as
``python scripts/<name>.py``). Tests under ``tests/`` use the full package
path ``scripts.<name>`` because ``tests/conftest.py`` adds the project
root to ``sys.path``.
"""
