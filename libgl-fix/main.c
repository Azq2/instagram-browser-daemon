#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdio.h>
#include <string.h>
#include <GL/gl.h>

// #define DEBUG fprintf
#define DEBUG(...)

extern void *_dl_sym(void *, const char *, void *);

typedef void *TYPE_dlsym(void *, const char *);
typedef const GLubyte *TYPE_glGetString(GLenum);
typedef const GLubyte *TYPE_glGetStringi(GLenum, GLuint index);

static TYPE_dlsym *original_dlsym = NULL;
static TYPE_glGetString *original_glGetString = NULL;
static TYPE_glGetStringi *original_glGetStringi = NULL;

__attribute__((constructor)) static void init(void) {
	original_dlsym = _dl_sym(RTLD_NEXT, "dlsym", dlsym);
}

const GLubyte *glGetString(GLenum name) {
	const GLubyte *result;
	
	switch (name) {
		case GL_VENDOR:
			result = (GLubyte *) "Intel Open Source Technology Center";
		break;
		
		case GL_RENDERER:
			result = (GLubyte *) "Mesa DRI Intel(R) HD Graphics 620 (Kaby Lake GT2)";
		break;
		/*
		case GL_VERSION:
			result = (GLubyte *) "1.2 Mesa 18.3.6";
		break;
		
		case GL_SHADING_LANGUAGE_VERSION:
			result = (GLubyte *) "1.20";
		break;
		*/
		default:
			if (!original_glGetString)
				original_glGetString = (TYPE_glGetString *) original_dlsym(RTLD_NEXT, "glGetString");
			result = original_glGetString(name);
		break;
	}
	
	DEBUG(stderr, "OVERRIDE: glGetString(%d) = %s\n", name, (const char *) result);
	return result;
}

const GLubyte *glGetStringi(GLenum name, GLuint index) {
	if (!original_glGetStringi)
		original_glGetStringi = (TYPE_glGetStringi *) original_dlsym(RTLD_NEXT, "glGetStringi");
	
	const GLubyte *result = original_glGetStringi(name, index);
	DEBUG(stderr, "OVERRIDE: glGetStringi(%d, %d) = %s\n", name, index, (const char *) result);
	return result;
}

extern void *dlsym(void *handle, const char *symbol) {
	DEBUG(stderr, "dlsym(%p, %s)\n", handle, symbol);
	
	if (strcmp(symbol, "dlsym") == 0) 
		return (void *) dlsym;
	
	if (strcmp(symbol, "glGetString") == 0) 
		return (void *) glGetString;
	
	if (strcmp(symbol, "glGetStringi") == 0) 
		return (void *) glGetStringi;
	
	return original_dlsym(handle, symbol);
}
