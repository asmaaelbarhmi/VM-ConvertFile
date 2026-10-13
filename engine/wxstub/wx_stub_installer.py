"""Faux module `wx` pour exécuter Ink/Stitch sans interface graphique.
Chaque attribut ou sous-module demandé est fabriqué à la volée."""
import sys
import types
import importlib.abc
import importlib.machinery


class _Factice:
    """Classe passe-partout : accepte tout, ne fait rien."""
    def __init__(self, *a, **k):
        pass

    def __getattr__(self, nom):
        return _Factice()

    def __call__(self, *a, **k):
        return _Factice()

    def __iter__(self):
        return iter(())

    def __or__(self, autre):
        return self

    __ror__ = __and__ = __add__ = __or__
    __int__ = lambda self: 0
    __bool__ = lambda self: False


def _module_factice(nom):
    module = types.ModuleType(nom)
    module.__path__ = []
    module.__getattr__ = lambda attr: type(attr, (_Factice,), {}) if attr[:1].isupper() else _Factice()
    return module


class _Chargeur(importlib.abc.Loader):
    def create_module(self, spec):
        return _module_factice(spec.name)

    def exec_module(self, module):
        pass


class _Chercheur(importlib.abc.MetaPathFinder):
    def find_spec(self, nom, chemin, cible=None):
        if nom == "wx" or nom.startswith("wx."):
            return importlib.machinery.ModuleSpec(nom, _Chargeur(), is_package=True)
        return None


def installer():
    if not any(isinstance(f, _Chercheur) for f in sys.meta_path):
        sys.meta_path.insert(0, _Chercheur())
