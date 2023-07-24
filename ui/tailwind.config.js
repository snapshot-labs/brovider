const content = ['layouts', 'components', 'pages', 'plugins'].map(
  folder => `./${folder}/**/*.{js,ts,vue}`
);
console.log(content);
module.exports = {
  content,
  theme: {
    extend: {
      colors: {
        primary: 'var(--primary-color)',
        secondary: 'var(--secondary-color)',
        success: 'var(--success-color)',
        danger: 'var(--danger-color)',
        warning: 'var(--warning-color)',
        info: 'var(--info-color)',
        light: 'var(--light-color)',
        dark: 'var(--dark-color)',
        'gray-light': 'var(--gray-light)',
        'gray-medium': 'var(--gray-medium)',
        'gray-dark': 'var(--gray-dark)'
      },
      borderRadius: {
        default: 'var(--default-border-radius)',
        button: 'var(--button-border-radius)'
      }
    }
  }
};
