import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { desktopClient } from '@/api/desktopClient';

const STORAGE_KEY = 'appLanguage';

const translations = {
  es: {
    'Berean Examination': 'Examinación Bereana',
    'In-depth Biblical Expository Study': 'Estudio expositivo bíblico en profundidad',
    'Something went wrong. Please try again.': 'Algo salió mal. Inténtalo de nuevo.',
    'Preparing your workspace...': 'Preparando tu espacio de trabajo...',
    'Continue': 'Continuar',
    'Go to Bible Study': 'Ir al estudio bíblico',
    'Go to Keywords': 'Ir a Palabras clave',
    'Profile': 'Perfil',
    'Manage your personal information': 'Administra tu información personal',
    'Preferences': 'Preferencias',
    'Customize your experience': 'Personaliza tu experiencia',
    'Security': 'Seguridad',
    'Notifications': 'Notificaciones',
    'Email and app alerts': 'Alertas por correo y en la app',
    'Privacy': 'Privacidad',
    'Privacy and data settings': 'Configuración de privacidad y datos',
    'Security Settings': 'Configuración de seguridad',
    'Coming soon - Advanced security features': 'Próximamente: funciones avanzadas de seguridad',
    'Quick Actions': 'Acciones rápidas',
    'Appearance': 'Apariencia',
    'Theme': 'Tema',
    'Light': 'Claro',
    'Dark': 'Oscuro',
    'Font Size': 'Tamaño de fuente',
    'Small': 'Pequeño',
    'Medium': 'Mediano',
    'Large': 'Grande',
    'Reading': 'Lectura',
    'Verse Display Format': 'Formato de visualización de versículos',
    'Inline (continuous)': 'En línea (continuo)',
    'Block (separate paragraphs)': 'En bloques (párrafos separados)',
    'General': 'General',
    'Time Zone': 'Zona horaria',
    'Default Landing Page': 'Página de inicio predeterminada',
    'Language': 'Idioma',
    'English': 'Inglés',
    'Spanish': 'Español',
    'Preferences updated successfully': 'Preferencias actualizadas correctamente',
    'Failed to update preferences': 'No se pudieron actualizar las preferencias',
    'Cancel': 'Cancelar',
    'Saving...': 'Guardando...',
    'Save Changes': 'Guardar cambios',
    'Loading your Bible Study...': 'Cargando tu estudio bíblico...',
    'Bible Study': 'Estudio bíblico',
    'My Bible Study Dashboard': 'Mi panel de estudio bíblico',
    'Chapter History': 'Historial de capítulos',
    'Select Chapter': 'Seleccionar capítulo',
    'Back': 'Atrás',
    'Bible Version': 'Versión bíblica',
    'Favorite': 'Favorita',
    'Favorited': 'Guardada',
    'saved as favorite': 'guardada como favorita',
    'Favorite Bible version cleared': 'Versión bíblica favorita eliminada',
    'Book': 'Libro',
    'Chapter': 'Capítulo',
    'Paste Chapter Text': 'Pegar texto del capítulo',
    'Prepare Text': 'Preparar texto',
    'Paste some text first': 'Primero pega algo de texto',
    'Text prepared with verse markers': 'Texto preparado con marcadores de versículo',
    'Nothing to copy': 'Nada para copiar',
    'Copied to clipboard': 'Copiado al portapapeles',
    'Loading Chapter...': 'Cargando capítulo...',
    'Back to Progress': 'Volver al progreso',
    'Open Another Bible Study': 'Abrir otro estudio bíblico',
    'Annotations': 'Anotaciones',
    'No chapter text found': 'No se encontró texto del capítulo',
    'This chapter was created but has no text. Add the chapter text to begin studying.': 'Este capítulo fue creado pero no tiene texto. Agrega el texto del capítulo para comenzar a estudiar.',
    'Add Chapter Text': 'Agregar texto del capítulo',
    'This is a read-only section from the Literal Standard Version.': 'Esta es una sección de solo lectura de la Literal Standard Version.',
    'Display': 'Visualización',
    'Bible Study Tools': 'Herramientas de estudio bíblico',
    'Hide Bible Study Tools': 'Ocultar herramientas de estudio bíblico',
    'Feedback & Contact': 'Comentarios y contacto',
    'Sources & Licenses': 'Fuentes y licencias',
    'Add Annotation': 'Agregar anotación',
    'Edit Annotation': 'Editar anotación',
    'Delete': 'Eliminar',
    'Save': 'Guardar',
    'Must type at least 1 character': 'Debes escribir al menos 1 carácter',
    'Drawing saved': 'Dibujo guardado',
    'Interlinear Mode': 'Modo interlineal',
    'Show the matching source verse beneath the translation.': 'Muestra el versículo fuente correspondiente debajo de la traducción.',
    'Interlinear On': 'Interlineal activado',
    'Interlinear Off': 'Interlineal desactivado',
    'Source Text': 'Texto fuente',
    'Loading source text…': 'Cargando texto fuente…',
    'Interlinear Source: SBLGNT': 'Fuente interlineal: SBLGNT',
    'Interlinear Source: UXLC': 'Fuente interlineal: UXLC',
    'UXLC / Leningrad Codex': 'UXLC / Códice de Leningrado',
    'Reading Controls': 'Controles de lectura',
    'See Context': 'Ver contexto',
    'Add Context': 'Agregar contexto',
    'Chapter Notes': 'Notas del capítulo',
    'Add Notes': 'Agregar notas',
    'See Application': 'Ver aplicación',
    'Add Application': 'Agregar aplicación',
    'Edit Chapter Text': 'Editar texto del capítulo'
  }
};

const I18nContext = createContext({
  language: 'en',
  setLanguage: () => {},
  tr: (text) => text,
});

export function I18nProvider({ children }) {
  const [language, setLanguageState] = useState(() => localStorage.getItem(STORAGE_KEY) || 'en');

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, language);
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    const loadLanguage = async () => {
      try {
        const isAuth = await desktopClient.owner.exists();
        if (!isAuth) return;
        const user = await desktopClient.owner.read();
        const preferred = user?.preferred_language;
        if (preferred && preferred !== language) {
          setLanguageState(preferred);
        }
      } catch {}
    };
    loadLanguage();
  }, []);

  const value = useMemo(() => ({
    language,
    setLanguage: setLanguageState,
    tr: (text) => translations[language]?.[text] || text,
  }), [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
